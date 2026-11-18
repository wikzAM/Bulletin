import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { JsonlEventLog } from "./jsonl-event-log";
import { openEventLog } from "./open-event-log";
import { SqliteEventLog } from "./sqlite-event-log";

let directory: string;
let database: string;
let legacy: string;
let log: JsonlEventLog | SqliteEventLog | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bulletin-sqlite-"));
  database = join(directory, "events.sqlite");
  legacy = join(directory, "events.jsonl");
});

afterEach(async () => {
  await log?.close();
  log = undefined;
  await Promise.all([database, legacy, `${legacy}.1`].map((path) => rm(path, { force: true })));
  await rmdir(directory);
});

it("publishes committed events in stable order and restores the same stream on reopen", async () => {
  log = await openEventLog(directory, legacy);
  const published = log.events;
  const mission_id = "demo";
  const circular: Record<string, unknown> = {};
  circular.circular = circular;
  await expect(log.emit({ mission_id, type: "mission.created", payload: circular })).rejects.toThrow();
  const written = await Promise.all([
    log.emit({ mission_id, type: "mission.created" }),
    log.emit({ mission_id, type: "ledger.charged", unit_id: "seed", payload: { cost_cents: 0.5 } }),
  ]);
  expect(written.map(({ id }) => id)).toEqual([1, 2]);
  expect(log.events).toBe(published);
  expect(published).toEqual(written);
  await log.close();
  await expect(log.emit({ mission_id, type: "mission.finished" })).rejects.toThrow(/closed/i);

  const db = new DatabaseSync(database);
  try {
    expect(db.prepare("SELECT payload FROM events WHERE id = 2").get()?.payload).toBe('{"cost_cents":0.5}');
    expect(() => db.exec("UPDATE events SET mission_id = 'other'")).toThrow(/append.only/i);
    expect(() => db.exec("DELETE FROM events")).toThrow(/append.only/i);
  } finally {
    db.close();
  }

  log = await SqliteEventLog.open(database);
  expect(log.events).toEqual(written);
  expect((await log.emit({ mission_id, type: "mission.finished" })).id).toBe(3);
});

it("imports all legacy JSONL segments once and preserves the original event IDs", async () => {
  log = await JsonlEventLog.open(legacy, 1);
  const mission_id = "legacy";
  const created = await log.emit({ mission_id, type: "mission.created" });
  const approved = await log.emit({ mission_id, type: "plan.approved" });
  await log.close();

  log = await openEventLog(directory, legacy);
  expect(log.events).toEqual([created, approved]);
  const finished = await log.emit({ mission_id, type: "mission.finished" });
  expect(finished.id).toBe(3);
  await log.close();
  log = await openEventLog(directory, legacy);
  expect(log.events).toEqual([created, approved, finished]);
});

it("can explicitly keep the legacy JSONL store", async () => {
  log = await openEventLog(directory, legacy, "jsonl");
  expect(log).toBeInstanceOf(JsonlEventLog);
  const event = await log.emit({ mission_id: "legacy", type: "mission.created" });
  await log.close();
  log = await JsonlEventLog.open(legacy);
  expect(log.events).toEqual([event]);
});
