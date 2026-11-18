import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { startSidecar, type SidecarClient } from "../../../packages/packaging/src/sidecar-client";
import { git } from "../../../packages/runners/src/git";

const root = resolve(import.meta.dirname, "../../..");

async function prepareRepo(repo: string) {
  await mkdir(repo);
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.name", "Fixture");
  await git(repo, "config", "user.email", "fixture@example.invalid");
  await git(repo, "config", "commit.gpgsign", "false");
  await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node check.mjs" } }));
  await writeFile(join(repo, "value.txt"), "0\n");
  await writeFile(join(repo, "check.mjs"), [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'assert.equal(readFileSync("value.txt", "utf8").trim(), "1");',
  ].join("\n"));
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", "fixture base");
}

async function prepareClaude(bin: string) {
  await mkdir(bin);
  const reply = '{"loggedIn":true}';
  if (process.platform === "win32") await writeFile(join(bin, "claude.cmd"), `@echo off\r\necho ${reply}\r\n`);
  else {
    const executable = join(bin, "claude");
    await writeFile(executable, `#!/bin/sh\necho '${reply}'\n`);
    await chmod(executable, 0o755);
  }
}

it("finishes the desktop setup and mission through the real sidecar with local fakes", async () => {
  const prefix = resolve(tmpdir(), "bulletin-desktop-flow-");
  const directory = await mkdtemp(prefix);
  if (!resolve(directory).startsWith(prefix)) throw new Error("Fixture directory is outside its expected path");
  const repo = join(directory, "repo");
  const bin = join(directory, "bin");
  let sidecar: SidecarClient | undefined;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.all([prepareRepo(repo), prepareClaude(bin)]);
    const executable = process.env.BULLETIN_SIDECAR_PATH?.trim();
    const env: NodeJS.ProcessEnv = {
      // Only operating system and tool lookup variables reach the fixture process.
      ...Object.fromEntries(["SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE"]
        .map((name) => [name, process.env[name]])),
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      NODE_ENV: "test",
      BULLETIN_RESOURCE_DIR: root,
      BULLETIN_DATA_DIR: join(directory, "data"),
      BULLETIN_SCRATCH_DIR: directory,
      BULLETIN_RUNNER: "test-fixture",
    };
    sidecar = await startSidecar(executable || process.execPath, executable ? [] : [
      "--import", "tsx", fileURLToPath(new URL("test-fixtures/desktop-flow.ts", import.meta.url)),
    ], { cwd: root, env });
    const client = sidecar;
    timeout = setTimeout(() => {
      if (client.pid !== undefined) {
        try { process.kill(client.pid); } catch { /* the child already exited */ }
      }
    }, 170_000).unref();

    const request = async <Body>(method: string, path: string, status: number, body?: object): Promise<Body> => {
      const reply = await client.request("request", { method, path, body }) as { status: number; body: Body };
      expect(reply.status, `${method} ${path}`).toBe(status);
      return reply.body;
    };

    expect(await client.request("env.check")).toMatchObject({
      git: { found: true, version: expect.stringMatching(/^git version/) },
      claude: { found: true, logged_in: true }, provider: { id: "claude-code", ready: true },
    });
    expect(await client.request("repo.inspect", { path: repo })).toMatchObject({
      is_repo: true, branch: "main", dirty: false, test_command: "npm test", file_count: 3,
    });

    const briefing = await request<{ id: string }>("POST", "/briefings", 201, { goal: "Set the value to 1" });
    expect(briefing).toMatchObject({ status: "interview", question_number: 1, question: "What value should the file contain?" });
    const completed = await request("POST", `/briefings/${briefing.id}/answers`, 200, { question_number: 1, answer: "1" });
    expect(completed).toMatchObject({ status: "complete", version: 1 });

    const { mission_id, plan } = await request<{ mission_id: string; plan: object }>("POST", "/missions", 201, {
      goal: "Set the value to 1", repo, briefing_id: briefing.id, budget_cents: 50,
    });
    expect(plan).toMatchObject({ briefing_version: 1, units: [expect.objectContaining({ id: "write-value" })] });
    const first = await client.request("subscribe", { mission_id }) as { subscription_id: number };
    const second = await client.request("subscribe", { mission_id }) as { subscription_id: number };
    expect(first.subscription_id).not.toBe(second.subscription_id);
    await expect.poll(() => client.events.filter((event) => event.mission_id === mission_id && event.type === "mission.created").length,
      { timeout: 30_000 }).toBe(2);
    expect(await client.request("unsubscribe", first)).toEqual({ unsubscribed: true });
    const question = await request<{ id: string }>("POST", "/questions", 201, { mission_id, body: "Which value?" });
    for (const type of ["dispatch.asked", "decision.opened"]) {
      const event = await client.waitForEvent(
        (event) => event.mission_id === mission_id && event.type === type && event.payload?.question_id === question.id,
        30_000,
      );
      expect(event.payload).toMatchObject({ question_id: question.id });
    }
    await request("POST", `/questions/${question.id}/answer`, 200, { answer: "1" });
    expect(await request("POST", "/questions", 201, { mission_id, body: "WHICH value?" })).toMatchObject({ source: "cache", answer: "1" });
    await request("POST", `/missions/${mission_id}/approve`, 202);
    const finished = await client.waitForEvent((event) => event.mission_id === mission_id && event.type === "mission.finished", 90_000);
    expect(finished.payload).toMatchObject({ shipped: 1, failed: 0 });
    expect(client.events.map(({ type }) => type)).toEqual(expect.arrayContaining([
      "mission.created", "briefing.versioned", "decision.resolved", "plan.approved", "unit.merged", "mission.finished",
    ]));
    expect(await request("GET", `/missions/${mission_id}/report`, 200)).toMatchObject({
      shipped: ["write-value"], attempts: 1, model_calls: 1, cost_cents: 0.3, cost_per_green_unit_cents: 0.3,
      touches: 1, touch_rate: 1, auto_answer_rate: 0.5,
    });
    expect(client.events.filter((event) => event.mission_id === mission_id && event.type === "mission.finished")).toHaveLength(1);
    expect(await client.request("unsubscribe", second)).toEqual({ unsubscribed: false });
    expect(await git(repo, "show", `bulletin/${mission_id}/integration:value.txt`)).toBe("1");
    expect(await git(repo, "show", "main:value.txt")).toBe("0");
    expect(await client.close()).toBe(0);
  } finally {
    try { await sidecar?.close(); } finally {
      clearTimeout(timeout);
      await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
    }
  }
}, 180_000);
