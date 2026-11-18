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
      touches: 1, touch_rate: 1, auto_answer_rate: null, elapsed_ms: 25_000,
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
      cost_per_green_unit_cents: null, touches: 0, touch_rate: null, auto_answer_rate: null, elapsed_ms: expect.any(Number),
    });
  } finally {
    await app.close();
  }
});

it("derives touches, the auto-answer rate, and cost per green unit from mission events", async () => {
  const history: RecordedEvent[] = [
    ["mission.created", null],
    ["briefing.versioned", null, { version: 1 }], ["plan.proposed", null],
    ["briefing.versioned", null, { version: 2 }], ["plan.proposed", null], ["plan.approved", null],
    ["dispatch.asked", "first", { question_id: "human" }],
    ["decision.opened", "first", { question_id: "human", kind: "question" }],
    ["briefing.versioned", null, { version: 3, reason: "question_answer" }],
    ["dispatch.answered", "first", { question_id: "human", answer: "17" }],
    ["decision.resolved", "first", { question_id: "human", kind: "question" }],
    ["dispatch.asked", "second", { question_id: "cited" }],
    ["dispatch.answered", "second", { question_id: "cited", source: "briefing" }],
    ["decision.resolved", "second", { question_id: "cited", source: "briefing" }],
    ["dispatch.asked", "second", { dispatch_id: "reused" }],
    ["dispatch.answered", "second", { dispatch_id: "reused", source: "cache" }],
    ["dispatch.asked", "third", { question_id: "pending" }],
    ["decision.opened", "third", { question_id: "pending" }],
    ["pass.green", "first"], ["unit.merged", "first"], ["ledger.charged", "first", { cost_cents: 1.25 }],
    ["pass.green", "second"], ["unit.merged", "second"], ["ledger.charged", "second", { cost_cents: 2.75 }],
    ["pass.green", "third"], ["unit.sent_back", "third"], ["pass.red", "third"],
    ["ledger.charged", "third", { cost_cents: 2.25 }], ["mission.finished", null, { touches: 99 }],
    ["dispatch.answered", "third", { question_id: "pending", source: "cache" }],
    ["decision.resolved", "third", { question_id: "pending" }],
  ];
  const log = new MemoryEventLog();
  for (const [type, unit_id, payload] of history) await log.emit({ mission_id: "demo", type, unit_id, payload });
  const app = buildServer(log);
  try {
    const report = await app.inject("/missions/demo/report");
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      shipped: ["first", "second"], touches: 3, touch_rate: 1.5,
      auto_answer_rate: 0.5, cost_cents: 6.25, cost_per_green_unit_cents: 3.125,
    });
  } finally {
    await app.close();
  }
});

it("counts an open hold as zero human touches even when an older finish payload reports it", async () => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  await log.emit({ mission_id, type: "mission.created" });
  await log.emit({ mission_id, unit_id: "seed", type: "unit.held" });
  await log.emit({ mission_id, unit_id: "seed", type: "decision.opened", payload: { kind: "closed_lane_merge" } });
  await log.emit({ mission_id, type: "mission.finished", payload: { touches: 1 } });
  const app = buildServer(log);
  try {
    const response = await app.inject("/missions/demo/report");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ held: ["seed"], touches: 0, touch_rate: null, auto_answer_rate: null });
  } finally {
    await app.close();
  }
});
