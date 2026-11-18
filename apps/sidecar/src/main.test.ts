import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { JsonlEventLog } from "../../api/src/store/jsonl-event-log";

it("proxies Fastify requests and replays and follows mission events over stdio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-sidecar-"));
  const data = join(directory, "api");
  const path = join(data, "events.jsonl");
  try {
    const log = await JsonlEventLog.open(path);
    await log.emit({ mission_id: "demo", type: "mission.created" });
    const finished = await log.emit({ mission_id: "demo", type: "mission.finished" });
    await log.close();

    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("main.ts", import.meta.url))], {
      env: { ...process.env, BULLETIN_SCRATCH_DIR: directory, BULLETIN_RUNNER: "claude", BULLETIN_API_TOKEN: "fixture-token" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const exited = once(child, "close");
    const timeout = setTimeout(() => child.kill(), 60_000);
    const output = createInterface({ input: child.stdout });
    const frames = output[Symbol.asyncIterator]();
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    const send = (id: number, method: string, params?: unknown) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    };
    const receive = async () => {
      const message = await frames.next();
      if (message.done) throw new Error(`Sidecar exited before sending a frame. ${stderr}`);
      return JSON.parse(message.value);
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
      const replies = [await receive(), await receive(), await receive()];
      expect(replies).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 6, result: expect.objectContaining({ status: 201 }) }),
        expect.objectContaining({ method: "event", params: expect.objectContaining({ event: expect.objectContaining({ id: 3, type: "dispatch.asked" }) }) }),
        expect.objectContaining({ method: "event", params: expect.objectContaining({ event: expect.objectContaining({ id: 4, type: "decision.opened" }) }) }),
      ]));
      send(7, "unsubscribe", { subscription_id: 1 });
      expect(await receive()).toMatchObject({ id: 7, result: { unsubscribed: true } });
      send(8, "subscribe", { mission_id: "missing" });
      expect(await receive()).toMatchObject({ id: 8, error: { code: -32004 } });
      child.stdin.end();
      expect(await exited).toEqual([0, null]);
    } finally {
      clearTimeout(timeout);
      output.close();
      child.kill();
      await exited;
    }
  } finally {
    await rm(path, { force: true });
    await rm(join(data, "briefings.jsonl"), { force: true });
    await rmdir(data);
    await rmdir(directory);
  }
}, 65_000);
