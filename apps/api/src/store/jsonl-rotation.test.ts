import { appendFile, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { JsonlEventLog } from "./jsonl-event-log";

let directory: string;
let path: string;
let log: JsonlEventLog | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bulletin-jsonl-rotation-"));
  path = join(directory, "events.jsonl");
});

afterEach(async () => {
  await log?.close();
  log = undefined;
  await Promise.all([path, `${path}.1`, `${path}.2`].map((file) => rm(file, { force: true })));
  await rmdir(directory);
});

it("rotates oversized segments without rewriting history and continues IDs after reopening", async () => {
  log = await JsonlEventLog.open(path, 1);
  const mission_id = "demo";
  const [created, approved] = await Promise.all([
    log.emit({ mission_id, type: "mission.created" }),
    log.emit({ mission_id, type: "plan.approved" }),
  ]);
  expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(created)}\n`);
  expect(await readFile(`${path}.1`, "utf8")).toBe(`${JSON.stringify(approved)}\n`);
  await log.close();

  log = await JsonlEventLog.open(path, 1);
  expect(log.events).toEqual([created, approved]);
  const completed = await log.emit({ mission_id, type: "mission.finished" });
  expect(completed.id).toBe(3);
  expect(await readFile(`${path}.2`, "utf8")).toBe(`${JSON.stringify(completed)}\n`);
  expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(created)}\n`);
});

it("recovers a torn write on the current segment without truncating archived data", async () => {
  log = await JsonlEventLog.open(path, 1);
  const created = await log.emit({ mission_id: "demo", type: "mission.created" });
  const approved = await log.emit({ mission_id: "demo", type: "plan.approved" });
  await log.close();
  await appendFile(`${path}.1`, '{"id":3');

  log = await JsonlEventLog.open(path, 1);
  expect(log.events).toEqual([created, approved]);
  expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(created)}\n`);
  expect(await readFile(`${path}.1`, "utf8")).toBe(`${JSON.stringify(approved)}\n`);
});

it("rejects an incomplete archived segment and preserves it byte for byte", async () => {
  log = await JsonlEventLog.open(path, 1);
  await log.emit({ mission_id: "demo", type: "mission.created" });
  await log.emit({ mission_id: "demo", type: "plan.approved" });
  await log.close();
  await appendFile(path, '{"broken":');
  const contents = await readFile(path, "utf8");

  await expect(JsonlEventLog.open(path, 1)).rejects.toThrow(/incomplete.*archived/i);
  expect(await readFile(path, "utf8")).toBe(contents);
});
