import { appendFile, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server";
import { JsonlEventLog } from "./jsonl-event-log";

describe("JSONL mission event log", () => {
  let directory: string;
  let path: string;
  let log: JsonlEventLog | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "bulletin-jsonl-"));
    path = join(directory, "events.jsonl");
  });

  afterEach(async () => {
    await log?.close();
    log = undefined;
    await rm(path, { force: true });
    await rmdir(directory);
  });

  it("serializes concurrent writes with increasing IDs and reloads mission views after restart", async () => {
    log = await JsonlEventLog.open(path);
    const mission_id = "demo";
    const written = await Promise.all([
      log.emit({ mission_id, type: "mission.created", payload: { repo: "/repos/demo", base: "main" } }),
      log.emit({ mission_id, type: "plan.approved" }),
      log.emit({ mission_id, type: "ledger.charged", payload: { cost_cents: 0.5 } }),
    ]);
    expect(written.map(({ id }) => id)).toEqual([1, 2, 3]);
    const contents = await readFile(path, "utf8");
    expect(contents).toBe(written.map((event) => `${JSON.stringify(event)}\n`).join(""));
    await log.close();

    log = await JsonlEventLog.open(path);
    expect(log.events).toEqual(written);
    const app = buildServer(log);
    try {
      const res = await app.inject("/missions/demo");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: "demo", status: "running", ledger: { cost_cents: 0.5, charges: 1 } });
      const stream = await app.inject({ url: "/missions/demo/events?after=2", payloadAsStream: true });
      expect(stream.statusCode).toBe(200);
      await app.close();
      let replay = "";
      for await (const chunk of stream.stream().setEncoding("utf8")) replay += chunk;
      expect(replay).toContain(`id: 3\nevent: ledger.charged\ndata: ${JSON.stringify(written[2])}\n\n`);
      expect(replay).not.toContain("id: 2\n");
      const finished = await log.emit({ mission_id, type: "mission.finished" });
      expect(finished.id).toBe(4);
      expect(await readFile(path, "utf8")).toBe(`${contents}${JSON.stringify(finished)}\n`);
    } finally {
      await app.close();
    }
  });

  it("discards an incomplete final line without losing complete events", async () => {
    log = await JsonlEventLog.open(path);
    const first = await log.emit({ mission_id: "demo", type: "mission.created" });
    await log.close();
    await appendFile(path, '{"id":2,"mission_id":"demo"');

    log = await JsonlEventLog.open(path);
    expect(log.events).toEqual([first]);
    const next = await log.emit({ mission_id: "demo", type: "plan.proposed" });
    expect(next.id).toBe(2);
    expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(first)}\n${JSON.stringify(next)}\n`);
  });

  it("rejects a corrupt terminated line and leaves the file available for inspection", async () => {
    const contents = '{"unexpected":"value"}\n';
    await writeFile(path, contents);
    await expect(JsonlEventLog.open(path)).rejects.toThrow(/invalid event.*line 1/i);
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  it("allows later appends after a serialization error and drains writes on close", async () => {
    log = await JsonlEventLog.open(path);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const failed = expect(log.emit({ mission_id: "demo", type: "mission.created", payload: circular })).rejects.toThrow();
    const succeeded = log.emit({ mission_id: "demo", type: "mission.created" });
    await log.close();
    await failed;
    expect((await succeeded).id).toBe(1);
    await expect(log.emit({ mission_id: "demo", type: "plan.proposed" })).rejects.toThrow(/closed/i);
  });

  it("starts one runner when two approvals race with a durable append", async () => {
    log = await JsonlEventLog.open(path);
    const mission_id = "demo";
    await log.emit({ mission_id, type: "mission.created", payload: { repo: "/repos/demo", base: "main" } });
    await log.emit({ mission_id, type: "plan.proposed", payload: {
      plan: { briefing_version: 1, units: [{ id: "a", title: "Add a", task: "Add a file", files: ["a.txt"] }] },
    } });
    const startMission = vi.fn(async () => {});
    const app = buildServer(log, { startMission });
    try {
      const approve = () => app.inject({ method: "POST", url: "/missions/demo/approve" });
      const responses = await Promise.all([approve(), approve()]);
      expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([202, 409]);
      expect(startMission).toHaveBeenCalledTimes(1);
      expect(log.events.map(({ type }) => type)).toEqual(["mission.created", "plan.proposed", "plan.approved"]);
    } finally {
      await app.close();
    }
  });
});
