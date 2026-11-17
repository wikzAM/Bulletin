import { MemoryEventLog } from "@bulletin/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer, type ServerOptions } from "../server";
import type { MissionStarter } from "./mission-approval";

const plan = {
  briefing_version: 1,
  units: [{ id: "seed", title: "Seed", task: "Add demo data", files: ["src/seed.ts"], acceptance: [], lane: "open", needs: [], tier: "station" }],
};
const missionMetadata = { repo: "D:/repos/todo-app", base: "main", goal: "Add demo data" };

describe("POST /missions/:id/approve", () => {
  let events: MemoryEventLog;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    events = new MemoryEventLog();
    await events.emit({ mission_id: "demo", type: "mission.created", payload: missionMetadata });
  });

  afterEach(async () => {
    await app?.close();
  });

  async function propose() {
    await events.emit({ mission_id: "demo", type: "plan.proposed", payload: { plan } });
  }

  function server(options?: ServerOptions) {
    app = buildServer(events, options);
  }

  function approve(id = "demo") {
    return app.inject({ method: "POST", url: `/missions/${id}/approve` });
  }

  it("starts only one background run and keeps its events in the mission log", async () => {
    await propose();
    let finish!: () => void;
    const canFinish = new Promise<void>((resolve) => { finish = resolve; });
    const startMission = vi.fn<MissionStarter>(async ({ missionId, events: sink }) => {
      await sink.emit({ mission_id: missionId, type: "mission.created" });
      await sink.emit({ mission_id: missionId, type: "plan.proposed", payload: { units: 1 } });
      await sink.emit({ mission_id: missionId, type: "plan.approved" });
      await sink.emit({ mission_id: missionId, type: "unit.started", unit_id: "seed" });
      await canFinish;
      await sink.emit({ mission_id: missionId, type: "mission.finished" });
    });
    server({ startMission });

    const responses = await Promise.all([approve(), approve()]);
    expect(responses.map((res) => res.statusCode).sort()).toEqual([202, 409]);
    expect(responses.find((res) => res.statusCode === 202)?.json()).toEqual({ mission_id: "demo", status: "running" });
    expect(responses.find((res) => res.statusCode === 409)?.json()).toEqual({ error: "Mission already approved" });
    expect(startMission).toHaveBeenCalledExactlyOnceWith({
      missionId: "demo", repo: missionMetadata.repo, baseBranch: missionMetadata.base,
      briefing: missionMetadata.goal, plan, events: { emit: expect.any(Function) }, signal: expect.any(AbortSignal),
    });
    expect(events.events.map(({ type }) => type)).toEqual([
      "mission.created", "plan.proposed", "plan.approved", "unit.started",
    ]);
    finish();
    await vi.waitFor(() => expect(events.events.at(-1)?.type).toBe("mission.finished"));
    expect((await app.inject("/missions/demo")).json()).toMatchObject({ status: "finished" });
  });

  it("records a background runner failure in the same event log", async () => {
    await propose();
    server({ startMission: async () => { throw new Error("runner failed"); } });
    expect((await approve()).statusCode).toBe(202);
    await vi.waitFor(() => expect(events.events.at(-1)).toMatchObject({
      mission_id: "demo", type: "mission.finished", payload: { status: "failed", error: "Mission execution failed" },
    }));
    expect((await app.inject("/missions/demo")).json()).toMatchObject({ status: "failed" });
  });

  it("rejects an unknown mission or a missing plan", async () => {
    const startMission = vi.fn<MissionStarter>();
    server({ startMission });
    const missing = await approve("missing");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Mission not found" });

    const noPlan = await approve();
    expect(noPlan.statusCode).toBe(409);
    expect(noPlan.json()).toEqual({ error: "Mission has no plan to approve" });
    expect(startMission).not.toHaveBeenCalled();
    expect(events.events).toHaveLength(1);
  });

  it("leaves the proposal unchanged when a runner is unconfigured", async () => {
    await propose();
    server();
    const res = await approve();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Mission runner not configured" });
    expect(events.events).toHaveLength(2);
  });
});
