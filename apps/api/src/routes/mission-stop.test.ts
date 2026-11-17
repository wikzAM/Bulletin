import { MemoryEventLog } from "@bulletin/core";
import { expect, it, vi } from "vitest";
import { buildServer } from "../server";
import type { MissionStarter } from "./mission-approval";

it("signals the active runner and leaves the final event to the engine", async () => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  await log.emit({ mission_id, type: "mission.created", payload: { repo: "/repos/demo", base: "main" } });
  await log.emit({ mission_id, type: "plan.proposed", payload: { plan: {
    briefing_version: 1, units: [{ id: "seed", title: "Seed", task: "Seed data", files: ["seed.ts"] }],
  } } });
  let finish!: () => void;
  const readyToFinish = new Promise<void>((resolve) => { finish = resolve; });
  const startMission = vi.fn<MissionStarter>(async ({ signal, events }) => {
    await readyToFinish;
    await events.emit({ mission_id, type: "mission.finished", payload: { stopped: signal.aborted } });
  });
  const app = buildServer(log, { startMission });
  const stop = () => app.inject({ method: "POST", url: "/missions/demo/stop" });

  try {
    const pending = await stop();
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toEqual({ error: "Mission is not running" });
    expect((await app.inject({ method: "POST", url: "/missions/demo/approve" })).statusCode).toBe(202);
    const signal = startMission.mock.calls[0]?.[0].signal;
    expect(signal?.aborted).toBe(false);

    const res = await stop();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ mission_id, status: "stopping" });
    expect(signal?.aborted).toBe(true);
    expect((await stop()).statusCode).toBe(202);
    expect(log.events.map(({ type }) => type)).toEqual(["mission.created", "plan.proposed", "plan.approved"]);

    finish();
    await vi.waitFor(() => expect(log.events.at(-1)).toMatchObject({ type: "mission.finished", payload: { stopped: true } }));
    expect((await stop()).statusCode).toBe(409);
  } finally {
    finish();
    await app.close();
  }
});

it("returns 404 for an unknown mission and 400 for invalid input", async () => {
  const app = buildServer();
  try {
    const missing = await app.inject({ method: "POST", url: "/missions/missing/stop" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Mission not found" });
    const invalid = await app.inject({ method: "POST", url: "/missions/missing/stop", payload: { unexpected: true } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "Invalid request" });
  } finally {
    await app.close();
  }
});
