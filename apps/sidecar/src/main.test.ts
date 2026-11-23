import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { SqliteEventLog } from "../../api/src/store/sqlite-event-log";

/** A fake `git` and `claude` on a private PATH folder, so env.check does not depend on this machine's tools or login. */
async function fakeTools(bin: string): Promise<void> {
  const claudeOutput = '{"loggedIn": true, "email": "leak@example.com", "orgId": "org-leak"}';
  const scripts: Record<string, { win: string[]; posix: string[] }> = {
    git: {
      win: ["@echo off", 'if "%1"=="--version" (echo git version 9.9.9.fake) else (exit /b 128)'],
      posix: ['if [ "$1" = "--version" ]; then echo "git version 9.9.9.fake"; else exit 128; fi'],
    },
    claude: { win: ["@echo off", `echo ${claudeOutput}`], posix: [`echo '${claudeOutput}'`] },
  };
  for (const [name, body] of Object.entries(scripts)) {
    if (process.platform === "win32") await writeFile(join(bin, `${name}.cmd`), body.win.join("\r\n"));
    else {
      await writeFile(join(bin, name), ["#!/bin/sh", ...body.posix, ""].join("\n"));
      await chmod(join(bin, name), 0o755);
    }
  }
}

interface Frame {
  jsonrpc: string;
  id?: number | null;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: { subscription_id: number; event: { id: number; mission_id: string; type: string; ts: string } };
}

/** What the Rust bridge relies on when it forwards a frame (src-tauri/src/sidecar.rs `receive`). */
function expectContractFrame(line: string): Frame {
  expect(line.includes("\n")).toBe(false);
  const frame = JSON.parse(line) as Frame;
  expect(frame.jsonrpc).toBe("2.0");
  if (frame.method === undefined) {
    // A response: an integer id (null only when the request could not be parsed), and exactly one of result or error.
    expect(frame.id === null || Number.isInteger(frame.id)).toBe(true);
    expect(["result", "error"].filter((key) => key in frame)).toHaveLength(1);
    if (frame.error) {
      expect(Number.isInteger(frame.error.code)).toBe(true);
      expect(typeof frame.error.message).toBe("string");
    }
  } else {
    // A notification: only "event", no id, an object carrying a numeric subscription_id and a full event envelope.
    expect(frame.method).toBe("event");
    expect("id" in frame).toBe(false);
    const { subscription_id, event } = frame.params!;
    expect(typeof subscription_id).toBe("number");
    expect(Number.isInteger(event.id)).toBe(true);
    expect(typeof event.mission_id).toBe("string");
    expect(typeof event.type).toBe("string");
    expect(typeof event.ts).toBe("string");
  }
  return frame;
}

it("proxies Fastify requests and closes a finished mission replay over stdio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-sidecar-"));
  const data = join(directory, "api");
  const path = join(directory, "events.sqlite");
  const bin = join(directory, "bin");
  const sentinel = "sk-ant-sentinel-must-never-appear";
  try {
    await mkdir(data);
    await mkdir(bin);
    await fakeTools(bin);
    // The provider chosen on first run, saved by an earlier session of the app.
    await writeFile(join(directory, "settings.json"), JSON.stringify({ provider: "anthropic-key" }));
    const log = await SqliteEventLog.open(path);
    const finished = await (async () => {
      try {
        await log.emit({ mission_id: "demo", type: "mission.created", payload: { api_key: sentinel } });
        return await log.emit({ mission_id: "demo", type: "mission.finished" });
      } finally {
        await log.close();
      }
    })();

    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("main.ts", import.meta.url))], {
      env: {
        ...process.env, BULLETIN_DATA_DIR: directory, BULLETIN_SCRATCH_DIR: directory,
        BULLETIN_EVENT_STORE: "sqlite", BULLETIN_RUNNER: "claude", BULLETIN_API_TOKEN: "fixture-token",
        BULLETIN_PROVIDER: "", ANTHROPIC_API_KEY: sentinel, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const exited = once(child, "close");
    const timeout = setTimeout(() => child.kill(), 120_000);
    const output = createInterface({ input: child.stdout });
    const frames = output[Symbol.asyncIterator]();
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    const send = (id: number, method: string, params?: unknown) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    };
    const raw: string[] = [];
    const receive = async () => {
      const message = await frames.next();
      if (message.done) throw new Error(`Sidecar exited before sending a frame. ${stderr}`);
      raw.push(message.value);
      return expectContractFrame(message.value);
    };

    try {
      child.stdin.write("{\n");
      expect(await receive()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
      send(1, "health");
      expect(await receive()).toEqual({ jsonrpc: "2.0", id: 1, result: { status: "ok", service: "api" } });
      send(2, "request", { method: "GET", path: "/missions?status=finished" });
      expect(await receive()).toMatchObject({ id: 2, result: { status: 200, body: { missions: [{ id: "demo" }] } } });
      send(3, "request", { method: "GET", path: "/missing" });
      expect(await receive()).toMatchObject({ id: 3, result: { status: 404, body: { error: "Route not found" } } });
      send(4, "request", { method: "GET", path: "/missions/demo/events" });
      expect(await receive()).toMatchObject({ id: 4, error: { code: -32602 } });

      send(5, "subscribe", { mission_id: "demo", after: 1 });
      expect(await receive()).toEqual({ jsonrpc: "2.0", id: 5, result: { subscription_id: 1 } });
      expect(await receive()).toEqual({ jsonrpc: "2.0", method: "event", params: { subscription_id: 1, event: finished } });
      send(6, "request", { method: "POST", path: "/questions", body: { mission_id: "demo", body: "Which seed?" } });
      expect(await receive()).toMatchObject({ id: 6, result: { status: 201 } });
      send(7, "unsubscribe", { subscription_id: 1 });
      expect(await receive()).toMatchObject({ id: 7, result: { unsubscribed: false } });
      send(8, "subscribe", { mission_id: "missing" });
      expect(await receive()).toMatchObject({ id: 8, error: { code: -32004 } });

      // First-run methods the desktop calls: environment, repository, settings, secrets.
      send(9, "env.check");
      expect(await receive()).toEqual({
        jsonrpc: "2.0",
        id: 9,
        result: {
          git: { found: true, version: "git version 9.9.9.fake" },
          claude: { found: true, logged_in: true },
          provider: { id: "anthropic-key", ready: true, env: { ANTHROPIC_API_KEY: true } },
        },
      });
      send(10, "repo.inspect", { path: join(directory, "nowhere") });
      expect(await receive()).toMatchObject({ id: 10, result: { exists: false, is_repo: false, root: null, test_command: null } });
      await writeFile(join(data, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
      send(11, "repo.inspect", { path: data });
      expect(await receive()).toMatchObject({ id: 11, result: { exists: true, is_repo: false, test_command: "npm test" } });
      send(12, "repo.inspect", { path: "relative" });
      expect(await receive()).toMatchObject({ id: 12, error: { code: -32602 } });
      send(13, "settings.set", { values: { provider: "bedrock", setup_complete: true } });
      expect(await receive()).toEqual({ jsonrpc: "2.0", id: 13, result: { settings: { provider: "bedrock", setup_complete: true } } });
      send(14, "settings.get");
      expect(await receive()).toMatchObject({ id: 14, result: { settings: { provider: "bedrock", setup_complete: true } } });
      send(15, "settings.set", { values: { ANTHROPIC_API_KEY: "sk-ant-nope" } });
      expect(await receive()).toMatchObject({ id: 15, error: { code: -32602 } });
      send(16, "secret.has", { name: "ANTHROPIC_API_KEY" });
      expect(await receive()).toEqual({ jsonrpc: "2.0", id: 16, result: { name: "ANTHROPIC_API_KEY", present: true } });
      send(17, "secret.has", { name: "BULLETIN_GITHUB_TOKEN" });
      expect(await receive()).toMatchObject({ id: 17, result: { present: false } });
      send(18, "secret.set", { name: "BULLETIN_GITHUB_TOKEN", value: "ghp_sentinel_token" });
      expect(await receive()).toEqual({ jsonrpc: "2.0", id: 18, result: { name: "BULLETIN_GITHUB_TOKEN", stored: true } });
      send(19, "secret.has", { name: "BULLETIN_GITHUB_TOKEN" });
      expect(await receive()).toMatchObject({ id: 19, result: { present: true } });
      send(20, "secret.set", { name: "PATH", value: "C:/evil" });
      expect(await receive()).toMatchObject({ id: 20, error: { code: -32602 } });
      send(21, "subscribe", { mission_id: "demo", after: 100 });
      expect(await receive()).toMatchObject({ id: 21, result: { subscription_id: 2 } });
      send(22, "unsubscribe", { subscription_id: 2 });
      expect(await receive()).toMatchObject({ id: 22, result: { unsubscribed: false } });
      send(23, "settings.set", { values: { default_budget_cents: 750, unit_allowance_cents: 125 } });
      expect(await receive()).toMatchObject({ id: 23, result: { settings: { default_budget_cents: 750, unit_allowance_cents: 125 } } });
      send(24, "settings.get");
      expect(await receive()).toMatchObject({ id: 24, result: { settings: { default_budget_cents: 750, unit_allowance_cents: 125 } } });
      send(25, "request", { method: "GET", path: "/config" });
      expect(await receive()).toMatchObject({ id: 25, result: { status: 200, body: {
        limits: { default_budget_cents: 750, unit_allowance_cents: 125 },
      } } });
      send(26, sentinel, { value: "ghp_sentinel_token" });
      expect(await receive()).toMatchObject({ id: 26, error: { code: -32601 } });
      send(27, "logs.tail", { lines: 1 });
      expect(await receive()).toMatchObject({
        id: 27,
        result: { lines: [expect.stringMatching(/^\S+ RPC method not found$/)] },
      });
      send(28, "logs.tail", { lines: 500 });
      expect(await receive()).toMatchObject({
        id: 28,
        result: { lines: expect.arrayContaining([
          expect.stringMatching(/^\S+ Sidecar started$/), expect.stringMatching(/^\S+ RPC parse error$/),
        ]) },
      });
      send(29, "logs.tail", { lines: 501 });
      expect(await receive()).toMatchObject({ id: 29, error: { code: -32602 } });

      const diskLog = await readFile(join(directory, "logs", "sidecar.log"), "utf8");
      expect(diskLog).toContain("RPC method not found");
      expect(diskLog).not.toContain(sentinel);
      expect(diskLog).not.toContain("ghp_sentinel_token");
      expect(diskLog).not.toContain(directory);
      expect(diskLog).not.toMatch(/leak@example|org-leak/);

      send(30, "request", { method: "GET", path: "/missions/demo/events.ndjson" });
      const exported = await receive();
      expect(exported).toMatchObject({ id: 30, result: { status: 200, body: expect.any(String) } });
      const { body } = exported.result as { body: string };
      expect(body.trimEnd().split("\n").map((line) => JSON.parse(line) as unknown)).toEqual([
        expect.objectContaining({ type: "mission.created", payload: {} }),
        finished,
        expect.objectContaining({ type: "dispatch.asked" }),
        expect.objectContaining({ type: "decision.opened" }),
      ]);

      // No frame carries a secret value or anything from `claude auth status` beyond the login flag.
      const everything = raw.join("|");
      expect(everything).not.toContain(sentinel);
      expect(everything).not.toContain("ghp_sentinel_token");
      expect(everything).not.toMatch(/leak@example|org-leak/);

      child.stdin.end();
      expect(await exited).toEqual([0, null]);
    } finally {
      clearTimeout(timeout);
      output.close();
      child.kill();
      await exited;
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  }
}, 125_000);
