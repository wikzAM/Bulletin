import { BulletinEventSchema, type BulletinEvent, type NewEvent } from "@bulletin/core";
import type { EventLog } from "./event-log";
import { JsonlFile } from "./jsonl-file";

export class JsonlEventLog implements EventLog {
  private constructor(private readonly file: JsonlFile<BulletinEvent>) {}

  static async open(path: string): Promise<JsonlEventLog> {
    const file = await JsonlFile.open<BulletinEvent>(path, "event", (value, previous) => {
      const event = BulletinEventSchema.parse(value);
      if (event.id <= (previous?.id ?? 0)) throw new Error("Event IDs must increase");
      return event;
    });
    return new JsonlEventLog(file);
  }

  get events(): readonly BulletinEvent[] {
    return this.file.records;
  }

  emit(event: NewEvent): Promise<BulletinEvent> {
    return this.file.append((previous) => ({
      id: (previous?.id ?? 0) + 1,
      mission_id: event.mission_id,
      ts: new Date().toISOString(),
      type: event.type,
      unit_id: event.unit_id ?? null,
      payload: event.payload ?? {},
    }));
  }

  close(): Promise<void> {
    return this.file.close();
  }
}
