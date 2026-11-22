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

it("records the current schema version for a fresh database", async () => {
  log = await SqliteEventLog.open(database);
  const db = new DatabaseSync(database);
  try {
    expect(db.prepare("SELECT version FROM schema_version").all()).toEqual([{ version: 1 }]);
  } finally {
    db.close();
  }
});

it("upgrades an unversioned database without changing its events or next ID", async () => {
  const db = new DatabaseSync(database);
  try {
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
        mission_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        unit_id TEXT,
        payload TEXT NOT NULL CHECK (json_valid(payload))
      ) STRICT;
      INSERT INTO events VALUES (8, 'demo', '2026-11-19T15:00:00Z', 'mission.created', NULL, '{}');
    `);
  } finally {
    db.close();
  }

  log = await SqliteEventLog.open(database);
  expect(log.events).toEqual([{
    id: 8, mission_id: "demo", ts: "2026-11-19T15:00:00Z", type: "mission.created", unit_id: null, payload: {},
  }]);
  expect((await log.emit({ mission_id: "demo", type: "mission.finished" })).id).toBe(9);

  const upgraded = new DatabaseSync(database);
  try {
    expect(upgraded.prepare("SELECT version FROM schema_version").all()).toEqual([{ version: 1 }]);
    expect(() => upgraded.exec("DELETE FROM events")).toThrow(/append.only/i);
  } finally {
    upgraded.close();
  }
});

it("refuses a database from a newer Bulletin without changing its schema", async () => {
  const db = new DatabaseSync(database);
  try {
    db.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (99);
      CREATE TABLE future_events (body TEXT);
      INSERT INTO future_events VALUES ('keep this');
    `);
  } finally {
    db.close();
  }

  const open = async () => { log = await SqliteEventLog.open(database); };
  await expect(open()).rejects.toThrow("This database requires a newer version of Bulletin.");
  const reopened = new DatabaseSync(database);
  try {
    expect(reopened.prepare("SELECT version FROM schema_version").all()).toEqual([{ version: 99 }]);
    expect(reopened.prepare("SELECT body FROM future_events").all()).toEqual([{ body: "keep this" }]);
    expect(reopened.prepare("SELECT name FROM sqlite_schema WHERE name = 'events'").get()).toBeUndefined();
  } finally {
    reopened.close();
  }
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
