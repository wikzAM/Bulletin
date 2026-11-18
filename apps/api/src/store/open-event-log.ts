import { stat } from "node:fs/promises";
import { join } from "node:path";
import { JsonlEventLog } from "./jsonl-event-log";
import { SqliteEventLog } from "./sqlite-event-log";

export async function openEventLog(dataDirectory: string, legacyPath: string, store = "sqlite") {
  if (store === "jsonl") return JsonlEventLog.open(legacyPath);
  if (store !== "sqlite") throw new Error("BULLETIN_EVENT_STORE must be sqlite or jsonl");

  const legacy = await stat(legacyPath).then(() => legacyPath, (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  return SqliteEventLog.open(join(dataDirectory, "events.sqlite"), legacy);
}
