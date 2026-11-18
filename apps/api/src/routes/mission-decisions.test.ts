import { MemoryEventLog } from "@bulletin/core";
import { expect, it, vi } from "vitest";
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

async function holdForReview(log: MemoryEventLog) {
  const mission_id = "demo";
  const plan = { briefing_version: 1, units: [{ id: "seed", title: "Seed", task: "Add a seed", files: ["seed.txt"] }] };
  await log.emit({ mission_id, type: "mission.created", payload: { repo: "/repo", base: "main", goal: "Original goal", budget_cents: 250 } });
  await log.emit({ mission_id, type: "plan.proposed", payload: { plan } });
  await log.emit({ mission_id, type: "briefing.versioned", payload: { markdown: "# Current briefing" } });
  await log.emit({ mission_id, unit_id: "seed", type: "unit.held", payload: { branch: "bulletin/demo/seed-a1" } });
  const opened = await log.emit({ mission_id, unit_id: "seed", type: "decision.opened", payload: { kind: "closed_lane_merge" } });
  await log.emit({ mission_id, type: "mission.finished" });
  return { opened, plan };
}

it.each([["approve", "merged"], ["reject", "rejected"]] as const)("runs the engine for a held-unit %s before recording the decision", async (choice, outcome) => {
  const log = new MemoryEventLog();
  const { opened, plan } = await holdForReview(log);
  const resolveHeldMission = vi.fn(async () => outcome);
  const app = buildServer(log, { resolveHeldMission });
  try {
    const response = await app.inject({ method: "POST", url: "/missions/demo/decisions/seed/resolve", payload: { choice } });
    expect(response.statusCode).toBe(200);
    expect(resolveHeldMission).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      missionId: "demo", unitId: "seed", resolution: choice, repo: "/repo", baseBranch: "main", budgetCents: 250,
      briefing: "# Current briefing", plan: expect.objectContaining({ units: [expect.objectContaining(plan.units[0])] }),
      history: log.events, events: log,
    }));
    expect(response.json()).toMatchObject({ type: "decision.resolved", payload: { opened_event_id: opened.id, choice } });
  } finally {
    await app.close();
  }
});

it("keeps the held decision open when the engine reports a merge conflict", async () => {
  const log = new MemoryEventLog();
  const { opened } = await holdForReview(log);
  const resolveHeldMission = vi.fn(async () => "conflict" as const);
  const app = buildServer(log, { resolveHeldMission });
  try {
    const response = await app.inject({ method: "POST", url: "/missions/demo/decisions/seed/resolve", payload: { choice: "approve" } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Held branch conflicts with the integration branch" });
    expect((await app.inject("/missions/demo/decisions")).json()).toEqual({ decisions: [opened] });
    expect(log.events.some(({ type }) => type === "decision.resolved")).toBe(false);
  } finally {
    await app.close();
  }
});

it("records an already-applied choice on retry without repeating the engine operation", async () => {
  const log = new MemoryEventLog();
  const { opened } = await holdForReview(log);
  await log.emit({ mission_id: "demo", unit_id: "seed", type: "unit.merged", payload: { approved: true } });
  const resolveHeldMission = vi.fn(async () => "merged" as const);
  const app = buildServer(log, { resolveHeldMission });
  try {
    const url = "/missions/demo/decisions/seed/resolve";
    const rejected = await app.inject({ method: "POST", url, payload: { choice: "reject" } });
    expect(rejected.statusCode).toBe(409);

    const approved = await app.inject({ method: "POST", url, payload: { choice: "approve" } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ type: "decision.resolved", payload: { opened_event_id: opened.id, choice: "approve" } });
    expect(resolveHeldMission).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
