import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BulletinEventSchema, type PricesConfig } from "@bulletin/core";
import { git } from "@bulletin/runners/git";
import { StubRunner } from "@bulletin/runners/stub-runner";
import { expect, it } from "vitest";
import { runMission, type MissionReport } from "../orchestrator/run-mission";
import { buildServer } from "../server";
import { JsonlEventLog } from "../store/jsonl-event-log";

const prices: PricesConfig = {
  currency: "USD", unit: "per_million_tokens", as_of: "test",
  models: { "stub-model": { input: 1, output: 5, cache_write: 0, cache_read: 0 } },
};
const tiers = { station: "stub-model" };

it("plans, approves, streams and reports a real Git mission with the stub runner", async () => {
  const prefix = resolve(tmpdir(), "bulletin-api-flow-");
  const root = await mkdtemp(prefix);
  if (!resolve(root).startsWith(prefix)) throw new Error("Temporary repo was created outside its expected directory");
  const repo = join(root, "repo");
  const scratchDir = join(root, "scratch");
  const log = await JsonlEventLog.open(join(root, "events.jsonl"));
  const abort = new AbortController();
  let report: Promise<MissionReport> | undefined;
  const app = buildServer(log, {
    modelCall: async (_system, input) => {
      expect(input).toContain("value.txt");
      return JSON.stringify({ briefing_version: 1, units: [{
        id: "write-value", title: "Write the new value", task: "Set the value to 1", files: ["value.txt"],
        estimate: { input_tokens: 1000, output_tokens: 100 },
      }] });
    },
    pricing: { prices, tiers },
    startMission(mission) {
      report = runMission({
        ...mission, scratchDir, prices, tiers,
        runner: new StubRunner(repo, join(scratchDir, "stations"), () => ({ files: { "value.txt": "1\n" } })),
        testCommand: "node check.mjs",
        allowedCommands: ["node *"],
      });
      return report;
    },
  });

  try {
    await mkdir(repo);
    await git(repo, "init", "-q", "-b", "main");
    await git(repo, "config", "user.name", "Test User");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "commit.gpgsign", "false");
    await writeFile(join(repo, "value.txt"), "0\n");
    await writeFile(join(repo, "check.mjs"), `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
assert.equal(readFileSync("value.txt", "utf8").trim(), "1");
`);
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "fixture base");

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]);
    const created = await fetch(`${address}/missions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "Set the value to 1", repo, budget_cents: 50 }), signal,
    });
    expect(created.status).toBe(201);
    const { mission_id } = await created.json();
    const missionUrl = `${address}/missions/${mission_id}`;
    const stream = await fetch(`${missionUrl}/events`, { signal });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("Missing event stream body");
    const approved = await fetch(`${missionUrl}/approve`, { method: "POST", signal });
    expect(approved.status).toBe(202);
    expect(await approved.json()).toEqual({ mission_id, status: "running" });

    const decoder = new TextDecoder();
    let body = "";
    while (!/\nevent: mission\.finished\ndata: [^\n]+\n\n/.test(body)) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Event stream ended before the finished report");
      body += decoder.decode(value, { stream: true });
    }
    const events = [...body.matchAll(/^data: (.+)$/gm)].map((match) => BulletinEventSchema.parse(JSON.parse(match[1] ?? "")));
    expect(events.map(({ type }) => type)).toEqual([
      "mission.created", "plan.proposed", "plan.approved", "wave.started", "unit.started", "attempt.started",
      "ledger.charged", "pass.green", "attempt.ended", "unit.merged", "mission.finished",
    ]);
    expect(events.map(({ id }) => id)).toEqual(events.map((_, index) => index + 1));
    expect(events.at(-1)?.payload).toMatchObject({ stopped: false, shipped: 1, cost_cents: 0.15, touches: 0 });
    const treasury = await fetch(`${missionUrl}/treasury`, { signal });
    expect(treasury.status).toBe(200);
    expect(await treasury.json()).toEqual({
      mission_id, budget_cents: 50, cost_cents: 0.15, remaining_cents: 49.85, charges: 1,
      units: [{ id: "write-value", cost_cents: 0.15, charges: 1 }],
    });
    expect(await (await fetch(missionUrl, { signal })).json()).toMatchObject({ status: "finished", units: [{ id: "write-value", status: "merged" }] });
    const finished = await report;
    expect(finished).toMatchObject({ shipped: ["write-value"], costCents: 0.15 });
    expect(await git(repo, "show", `${finished?.integrationBranch}:value.txt`)).toBe("1");
  } finally {
    abort.abort();
    await report?.catch(() => undefined);
    await app.close();
    await log.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
