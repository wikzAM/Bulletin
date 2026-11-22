import { MemoryEventLog, type NewEvent } from "@bulletin/core";
import { expect, it } from "vitest";
import { buildServer } from "../server";

class DelayedArchiveLog extends MemoryEventLog {
  override async emit(event: NewEvent) {
    if (event.type === "mission.archived" || event.type === "mission.unarchived") {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return super.emit(event);
  }
}

it("replays archive changes and filters before limiting without changing mission status", async () => {
  const log = new DelayedArchiveLog();
  for (const mission_id of ["earlier", "later"]) {
    await log.emit({ mission_id, type: "mission.created" });
    await log.emit({ mission_id, type: "mission.finished" });
  }
  let app = buildServer(log);
  const post = (operation: "archive" | "unarchive") =>
    app.inject({ method: "POST", url: `/missions/earlier/${operation}` });

  try {
    const archived = await Promise.all([post("archive"), post("archive")]);
    for (const response of archived) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ mission_id: "earlier", archived: true });
    }
    expect(log.events.filter(({ type }) => type === "mission.archived")).toHaveLength(1);
    await app.close();
    app = buildServer(log);

    expect((await app.inject("/missions?status=finished&limit=1")).json()).toMatchObject({ missions: [{ id: "later" }] });
    expect((await app.inject("/missions?archived=0")).json()).toMatchObject({ missions: [{ id: "later" }] });
    expect((await app.inject("/missions?status=finished&archived=1")).json()).toMatchObject({
      missions: [{ id: "earlier", status: "finished", archived: true }, { id: "later", status: "finished" }],
    });
    expect((await app.inject("/missions/earlier")).json()).toMatchObject({ status: "finished", archived: true });
    expect((await app.inject("/missions/earlier/report")).statusCode).toBe(200);

    const restored = await Promise.all([post("unarchive"), post("unarchive")]);
    for (const response of restored) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ mission_id: "earlier", archived: false });
    }
    expect(log.events.filter(({ type }) => type === "mission.unarchived")).toHaveLength(1);
    expect((await app.inject("/missions")).json()).toMatchObject({ missions: [{ id: "earlier" }, { id: "later" }] });
    expect((await app.inject("/missions/earlier")).json()).not.toHaveProperty("archived");
  } finally {
    await app.close();
  }
});

it("rejects unknown missions, operation bodies with extra fields, and invalid archive filters", async () => {
  const log = new MemoryEventLog();
  await log.emit({ mission_id: "demo", type: "mission.created" });
  const app = buildServer(log);
  try {
    for (const operation of ["archive", "unarchive"]) {
      const missing = await app.inject({ method: "POST", url: `/missions/missing/${operation}` });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: "Mission not found" });
      const invalid = await app.inject({ method: "POST", url: `/missions/demo/${operation}`, payload: { extra: true } });
      expect(invalid.statusCode).toBe(400);
    }
    for (const query of ["archived=maybe", "archived=1&archived=0"]) {
      expect((await app.inject(`/missions?${query}`)).statusCode).toBe(400);
    }
    expect(log.events).toHaveLength(1);
  } finally {
    await app.close();
  }
});
