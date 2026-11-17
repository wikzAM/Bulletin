import { MemoryEventLog, type EventType } from "@bulletin/core";
import { expect, it } from "vitest";
import { buildServer } from "../server";

type RecordedEvent = [type: EventType, unitId: string | null, payload?: Record<string, unknown>];

const recorded: RecordedEvent[] = [
  ["mission.created", null], ["plan.proposed", null], ["plan.approved", null],
  ["wave.started", null, { wave: 1, units: ["seed", "review", "send-back", "publish"] }],
  ["unit.started", "seed"], ["attempt.started", "seed"], ["ledger.charged", "seed", { cost_cents: 0.75 }],
  ["pass.green", "seed"], ["attempt.ended", "seed"], ["unit.merged", "seed"],
  ["unit.started", "review"], ["attempt.started", "review"], ["ledger.charged", "review", { cost_cents: 1.25 }],
  ["pass.green", "review"], ["attempt.ended", "review"], ["unit.held", "review"],
  ["unit.started", "send-back"], ["attempt.started", "send-back"], ["ledger.charged", "send-back", { cost_cents: 1 }],
  ["pass.green", "send-back"], ["attempt.ended", "send-back"], ["unit.sent_back", "send-back", { reason: "merge conflict" }],
  ["attempt.started", "send-back"], ["pass.red", "send-back"], ["attempt.ended", "send-back"], ["unit.failed", "send-back"],
  ["unit.blocked", "publish"], ["mission.finished", null, { touches: 1 }], ["ledger.charged", null, { cost_cents: 99 }],
];

it("projects the final report from a recorded run and ignores later activity", async () => {
  const log = new MemoryEventLog();
  log.events.push(...recorded.map(([type, unit_id, payload = {}], index) => ({
    id: index + 1, mission_id: "demo", ts: new Date(Date.UTC(2026, 10, 17, 14, 0, index)).toISOString(),
    type, unit_id, payload,
  })));
  await log.emit({ mission_id: "other", type: "ledger.charged", payload: { cost_cents: 1000 } });
  const app = buildServer(log);
  try {
    const res = await app.inject("/missions/demo/report");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      mission_id: "demo", shipped: ["seed"], held: ["review"], failed: ["send-back"], blocked: ["publish"],
      attempts: 4, model_calls: 3, cost_cents: 3, cost_per_green_unit_cents: 1.5,
      touches: 1, touch_rate: 1, elapsed_ms: 25_000,
    });
  } finally {
    await app.close();
  }
});

it("distinguishes unknown, unfinished, and interrupted missions without shipped or passed units", async () => {
  const log = new MemoryEventLog();
  await log.emit({ mission_id: "demo", type: "mission.created" });
  const app = buildServer(log);
  try {
    const unknown = await app.inject("/missions/missing/report");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "Mission not found" });

    const unfinished = await app.inject("/missions/demo/report");
    expect(unfinished.statusCode).toBe(409);
    expect(unfinished.json()).toEqual({ error: "Mission has not finished" });

    await log.emit({ mission_id: "demo", type: "mission.finished", payload: { interrupted: true } });
    const interrupted = await app.inject("/missions/demo/report");
    expect(interrupted.statusCode).toBe(200);
    expect(interrupted.json()).toMatchObject({
      shipped: [], held: [], failed: [], blocked: [], attempts: 0, model_calls: 0, cost_cents: 0,
      cost_per_green_unit_cents: null, touches: 0, touch_rate: null, elapsed_ms: expect.any(Number),
    });
  } finally {
    await app.close();
  }
});
