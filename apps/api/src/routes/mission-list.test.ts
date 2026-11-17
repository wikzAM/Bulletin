import { MemoryEventLog } from "@bulletin/core";
import { expect, it } from "vitest";
import { buildServer } from "../server";

it("filters by status before limiting and keeps creation-event order", async () => {
  const log = new MemoryEventLog();
  const ts = "2026-11-17T14:00:00.000Z";
  log.events.push(...["running", "z-first", "a-second", "paused"].map((mission_id, index) => ({
    id: index + 1, mission_id, ts, type: "mission.created" as const, unit_id: null, payload: {},
  })));
  await log.emit({ mission_id: "a-second", type: "plan.proposed" });
  await log.emit({ mission_id: "z-first", type: "plan.proposed" });
  await log.emit({ mission_id: "running", type: "plan.approved" });
  await log.emit({ mission_id: "paused", type: "mission.finished", payload: { paused: true } });
  const app = buildServer(log);
  try {
    const first = await app.inject("/missions?status=planning&limit=1");
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ missions: [{ id: "z-first", status: "planning" }] });
    const full = await app.inject("/missions?status=planning");
    expect(full.json()).toMatchObject({ missions: [{ id: "z-first" }, { id: "a-second" }] });
    expect((await app.inject("/missions?limit=2")).json()).toMatchObject({ missions: [{ id: "running" }, { id: "z-first" }] });
    expect((await app.inject("/missions?status=paused")).json()).toMatchObject({ missions: [{ id: "paused" }] });
    expect((await app.inject("/missions?limit=0")).json()).toEqual({ missions: [] });
  } finally {
    await app.close();
  }
});

it.each(["status=unknown", "status=running&status=finished", "limit=-1", "limit=1.5", "limit=9007199254740992", "limit=1&limit=2"])(
  "rejects invalid mission list filters (%s)", async (query) => {
    const app = buildServer();
    try {
      const res = await app.inject(`/missions?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid request" });
    } finally {
      await app.close();
    }
  },
);
