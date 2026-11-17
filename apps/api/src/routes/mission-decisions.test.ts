import { MemoryEventLog } from "@bulletin/core";
import { expect, it } from "vitest";
import { buildServer } from "../server";

it("lists unresolved decisions by mission, matching both hold and question events", async () => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  await log.emit({ mission_id, type: "mission.created" });
  await log.emit({ mission_id, type: "decision.opened", unit_id: "old", payload: { kind: "gated_retry" } });
  await log.emit({ mission_id, type: "decision.resolved", unit_id: "old", payload: { kind: "gated_retry" } });
  const held = await log.emit({ mission_id, type: "decision.opened", unit_id: "seed", payload: { kind: "closed_lane_merge" } });
  await log.emit({ mission_id, type: "decision.opened", unit_id: "seed", payload: { kind: "question", question_id: "q1" } });
  const question = await log.emit({ mission_id, type: "decision.opened", unit_id: "seed", payload: { kind: "question", question_id: "q2" } });
  await log.emit({ mission_id, type: "decision.resolved", unit_id: "seed", payload: { kind: "question", question_id: "q1" } });
  await log.emit({ mission_id: "other", type: "decision.resolved", unit_id: "seed", payload: { kind: "closed_lane_merge" } });
  const budget = await log.emit({ mission_id, type: "decision.opened", payload: { kind: "budget_increase" } });
  const app = buildServer(log);
  try {
    const res = await app.inject("/missions/demo/decisions");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ decisions: [held, question, budget] });
  } finally {
    await app.close();
  }
});

it.each(["approve", "reject"])("records %s against the exact open unit decision once", async (choice) => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  await log.emit({ mission_id, type: "mission.created" });
  const held = await log.emit({ mission_id, type: "decision.opened", unit_id: "seed", payload: { kind: "gated_retry", branch: "bulletin/demo/seed-a2" } });
  const question = await log.emit({ mission_id, type: "decision.opened", unit_id: "seed", payload: { kind: "question", question_id: "q" } });
  await log.emit({ mission_id, type: "mission.finished" });
  const app = buildServer(log);
  try {
    const url = "/missions/demo/decisions/seed/resolve";
    const resolve = () => app.inject({ method: "POST", url, payload: { choice } });
    const res = await resolve();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(log.events.at(-1));
    expect(res.json()).toMatchObject({
      type: "decision.resolved", mission_id, unit_id: "seed",
      payload: { opened_event_id: held.id, kind: "gated_retry", choice },
    });
    expect((await app.inject("/missions/demo/decisions")).json()).toEqual({ decisions: [question] });
    const repeat = await resolve();
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Open decision not found" });
    expect(log.events.filter(({ type }) => type === "decision.resolved")).toHaveLength(1);
  } finally {
    await app.close();
  }
});

it("validates the choice and reports an unknown mission", async () => {
  const app = buildServer();
  try {
    const unknown = await app.inject("/missions/missing/decisions");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "Mission not found" });
    const url = "/missions/missing/decisions/seed/resolve";
    const invalid = await app.inject({ method: "POST", url, payload: { choice: "maybe" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "Invalid request" });
    const missing = await app.inject({ method: "POST", url, payload: { choice: "approve" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Mission not found" });
  } finally {
    await app.close();
  }
});
