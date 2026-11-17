import { constants } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { BulletinEventSchema, type BulletinEvent, type NewEvent } from "@bulletin/core";
import type { EventLog } from "./event-log";

function readEvents(contents: string, path: string): BulletinEvent[] {
  const events: BulletinEvent[] = [];
  for (const [index, line] of contents.split("\n").slice(0, -1).entries()) {
    try {
      const event = BulletinEventSchema.parse(JSON.parse(line));
      if (event.id <= (events.at(-1)?.id ?? 0)) throw new Error("Event IDs must increase");
      events.push(event);
    } catch (cause) {
      throw new Error(`Invalid event in ${path} at line ${index + 1}`, { cause });
    }
  }
  return events;
}

/** One API process owns the file and publishes events after their append reaches disk. */
export class JsonlEventLog implements EventLog {
  readonly events: readonly BulletinEvent[];
  private pending: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private writeError?: Error;

  private constructor(
    private readonly file: FileHandle,
    private readonly committed: BulletinEvent[],
    private bytesCommitted: number,
  ) {
    this.events = committed;
  }

  static async open(path: string): Promise<JsonlEventLog> {
    await mkdir(dirname(path), { recursive: true });
    // Windows append-only handles cannot truncate an interrupted last line.
    const file = await open(path, constants.O_CREAT | constants.O_RDWR, 0o600);
    try {
      const contents = await file.readFile();
      const bytesCommitted = contents.lastIndexOf(0x0a) + 1;
      const events = readEvents(contents.subarray(0, bytesCommitted).toString("utf8"), path);
      if (bytesCommitted !== contents.length) {
        // A record is complete once its terminating newline has been written.
        await file.truncate(bytesCommitted);
        await file.sync();
      }
      return new JsonlEventLog(file, events, bytesCommitted);
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async emit(event: NewEvent): Promise<BulletinEvent> {
    if (this.closing) throw new Error("Event log is closed");
    const append = this.pending.then(() => this.append(event));
    this.pending = append.then(() => undefined, () => undefined);
    return append;
  }

  close(): Promise<void> {
    this.closing ??= this.pending.then(() => this.file.close());
    return this.closing;
  }

  private async append(event: NewEvent): Promise<BulletinEvent> {
    if (this.writeError) throw this.writeError;
    const line = Buffer.from(`${JSON.stringify({
      id: (this.committed.at(-1)?.id ?? 0) + 1,
      mission_id: event.mission_id,
      ts: new Date().toISOString(),
      type: event.type,
      unit_id: event.unit_id ?? null,
      payload: event.payload ?? {},
    })}\n`);
    const stored = BulletinEventSchema.parse(JSON.parse(line.toString("utf8")));

    try {
      let offset = 0;
      while (offset < line.length) {
        const { bytesWritten } = await this.file.write(line, offset, line.length - offset, this.bytesCommitted + offset);
        if (bytesWritten === 0) throw new Error("Could not append an event to the log");
        offset += bytesWritten;
      }
      await this.file.sync();
    } catch (error) {
      try {
        await this.file.truncate(this.bytesCommitted);
        await this.file.sync();
      } catch (cause) {
        this.writeError = new Error("Could not recover the event log after an append failed", { cause });
        throw this.writeError;
      }
      throw error;
    }

    this.bytesCommitted += line.length;
    this.committed.push(stored);
    return stored;
  }
}
