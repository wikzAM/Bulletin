import { describe, expect, it } from "vitest";
import {
  toCreateMissionResponse,
  toMissionDetail,
  toMissionSummaries,
  toQuestion,
  toQuestions,
  toTreasuryInfo,
} from "../lib/api-adapters";

describe("toMissionSummaries", () => {
  it("unwraps { missions } and falls back to the repo when there is no goal", () => {
    const out = toMissionSummaries({
      missions: [
        { id: "demo", repo: "D:/repos/todo-app", base: "main", created_at: "2026-11-17T14:00:00.000Z", status: "running" },
        { id: "m2", goal: "Add dark mode", repo: null, base: null, created_at: "2026-11-17T15:00:00.000Z", status: "planning" },
      ],
    });
    expect(out).toEqual([
      { id: "demo", goal: "D:/repos/todo-app", status: "running", created_at: "2026-11-17T14:00:00.000Z", units_total: null, units_done: null },
      { id: "m2", goal: "Add dark mode", status: "planning", created_at: "2026-11-17T15:00:00.000Z", units_total: null, units_done: null },
    ]);
  });

  it("also accepts a bare array and keeps unit counts when given", () => {
    const out = toMissionSummaries([{ id: "a", goal: "g", status: "finished", created_at: "t", units_total: 3, units_done: 2 }]);
    expect(out[0]).toMatchObject({ units_total: 3, units_done: 2 });
  });

  it("drops entries without an id and maps unknown statuses to interview", () => {
    const out = toMissionSummaries({ missions: [{ status: "running" }, { id: "x", status: "weird", created_at: "t" }, null] });
    expect(out.map((m) => [m.id, m.status, m.goal])).toEqual([["x", "interview", "x"]]);
  });

  it("returns an empty list for anything that is not a list", () => {
    expect(toMissionSummaries({ error: "boom" })).toEqual([]);
    expect(toMissionSummaries(null)).toEqual([]);
  });
});

describe("toMissionDetail", () => {
  it("maps units with null lane and wave to defaults and uses the id as the title", () => {
    const out = toMissionDetail({
      id: "demo",
      repo: "D:/repos/todo-app",
      base: "main",
      created_at: "t",
      status: "running",
      units: [
        { id: "seed-data", status: "merged", lane: "open", wave: 1 },
        { id: "review", status: "pending", lane: null, wave: null },
      ],
      ledger: { cost_cents: 1.25, charges: 1 },
    });
    expect(out).toMatchObject({ id: "demo", goal: "D:/repos/todo-app", repo: "D:/repos/todo-app", status: "running" });
    expect(out?.units).toEqual([
      { id: "seed-data", title: "seed-data", lane: "open", wave: 1, needs: [] },
      { id: "review", title: "review", lane: "open", wave: 0, needs: [] },
    ]);
    expect(out).toMatchObject({ units_total: 2, units_done: 1 });
  });

  it("keeps a title and needs when the API sends them", () => {
    const out = toMissionDetail({ id: "a", status: "running", created_at: "t", units: [{ id: "u", title: "Store", lane: "gated", wave: 2, needs: ["x"] }] });
    expect(out?.units[0]).toEqual({ id: "u", title: "Store", lane: "gated", wave: 2, needs: ["x"] });
  });

  it("returns null for a body without an id", () => {
    expect(toMissionDetail({ error: "Mission not found" })).toBeNull();
  });
});

describe("toTreasuryInfo", () => {
  it("reads the budget", () => {
    expect(toTreasuryInfo({ mission_id: "demo", budget_cents: 500, cost_cents: 1.25 })).toEqual({ budget_cents: 500 });
  });

  it("returns null when the log has no budget", () => {
    expect(toTreasuryInfo({ mission_id: "demo", budget_cents: null })).toBeNull();
    expect(toTreasuryInfo(null)).toBeNull();
  });
});

describe("questions", () => {
  const raw = {
    id: "q1",
    mission_id: "demo",
    unit_id: "seed-data",
    body: "Which seed should I use?",
    status: "open",
    created_at: "t",
    answer: null,
    answered_at: null,
  };

  it("fills source and briefing_ref the API does not send", () => {
    expect(toQuestion(raw)).toEqual({ ...raw, source: null, briefing_ref: null });
  });

  it("treats an answered question with no source as answered by a person", () => {
    expect(toQuestion({ ...raw, status: "answered", answer: "17", answered_at: "t2" })?.source).toBe("human");
    expect(toQuestion({ ...raw, status: "answered", answer: "17", source: "briefing", briefing_ref: "Features" })).toMatchObject({ source: "briefing", briefing_ref: "Features" });
  });

  it("unwraps { questions } and drops malformed entries", () => {
    expect(toQuestions({ questions: [raw, { id: 4 }, null] }).map((q) => q.id)).toEqual(["q1"]);
    expect(toQuestions([raw])).toHaveLength(1);
    expect(toQuestions({})).toEqual([]);
  });
});

describe("toCreateMissionResponse", () => {
  const plan = {
    briefing_version: 1,
    units: [{ id: "u1", title: "Seed", task: "t", files: ["src/seed.ts"], needs: [], lane: "open", tier: "station", acceptance: ["pnpm test"] }],
  };

  it("reads a 201 as a valid plan", () => {
    expect(toCreateMissionResponse(201, { mission_id: "m", attempts: 1, plan })).toEqual({ ok: true, mission_id: "m", attempts: 1, plan });
  });

  it("reads 422 and 503 planning failures as plan errors", () => {
    const body = { error: "Mission planning failed", errors: ["fake edge: u2 waits for u1 but names nothing it reads"], attempts: 2 };
    expect(toCreateMissionResponse(422, body)).toEqual({ ok: false, mission_id: null, errors: body.errors, attempts: 2 });
    expect(toCreateMissionResponse(503, body)).toMatchObject({ ok: false, attempts: 2 });
  });

  it("throws the API's message for other failures", () => {
    expect(() => toCreateMissionResponse(422, { error: "Repository unavailable" })).toThrow("Repository unavailable");
    expect(() => toCreateMissionResponse(400, { error: "Invalid request" })).toThrow("Invalid request");
    expect(() => toCreateMissionResponse(500, null)).toThrow("500");
  });

  it("still accepts a body that already has ok", () => {
    expect(toCreateMissionResponse(200, { ok: false, mission_id: null, errors: ["x"], attempts: 1 })).toMatchObject({ ok: false });
  });
});
