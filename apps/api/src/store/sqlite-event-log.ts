import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { BulletinEventSchema, type BulletinEvent, type NewEvent } from "@bulletin/core";
import type { EventLog } from "./event-log";
import { JsonlEventLog } from "./jsonl-event-log";

const schema = `
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
    mission_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    unit_id TEXT,
    payload TEXT NOT NULL CHECK (json_valid(payload))
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'events table is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'events table is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS events_no_replace BEFORE INSERT ON events
    WHEN EXISTS (SELECT 1 FROM events WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'events table is append-only'); END;
`;

async function importLegacy(db: DatabaseSync, path: string): Promise<void> {
  const hasEvents = db.prepare("SELECT 1 FROM events LIMIT 1");
  if (hasEvents.get()) return;
  const legacy = await JsonlEventLog.open(path);
  try {
    const insert = db.prepare("INSERT INTO events (id, mission_id, ts, type, unit_id, payload) VALUES (?, ?, ?, ?, ?, ?)");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!hasEvents.get()) {
        for (const { id, mission_id, ts, type, unit_id, payload } of legacy.events) {
          insert.run(id, mission_id, ts, type, unit_id, JSON.stringify(payload));
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    await legacy.close();
  }
}

/** The API owns one connection and publishes its events after each committed insert. */
export class SqliteEventLog implements EventLog {
  readonly events: readonly BulletinEvent[];
  private readonly insert: StatementSync;
  private closed = false;

  private constructor(private readonly db: DatabaseSync, private readonly committed: BulletinEvent[]) {
    this.events = committed;
    this.insert = db.prepare("INSERT INTO events (mission_id, ts, type, unit_id, payload) VALUES (?, ?, ?, ?, ?)");
  }

  static async open(path: string, legacyPath?: string): Promise<SqliteEventLog> {
    const { DatabaseSync } = await import("node:sqlite");
    await mkdir(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    try {
      db.exec(schema);
      if (legacyPath) await importLegacy(db, legacyPath);
      const records = db.prepare("SELECT id, mission_id, ts, type, unit_id, payload FROM events ORDER BY id").all();
      const events = records.map((row) => BulletinEventSchema.parse({ ...row, payload: JSON.parse(String(row.payload)) }));
      return new SqliteEventLog(db, events);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  async emit(event: NewEvent): Promise<BulletinEvent> {
    if (this.closed) throw new Error("SQLite event log is closed");
    const json = JSON.stringify(event.payload ?? {});
    const ts = new Date().toISOString();
    const record = BulletinEventSchema.parse({ ...event, id: 0, ts, payload: JSON.parse(json) });
    const { lastInsertRowid } = this.insert.run(record.mission_id, ts, record.type, record.unit_id, json);
    record.id = Number(lastInsertRowid);
    this.committed.push(record);
    return record;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
