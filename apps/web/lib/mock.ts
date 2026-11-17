import type { BulletinEvent, EventType } from "@bulletin/core";
import type { CreateMissionResponse, MissionDetail, MissionSummary, Question, TreasuryInfo } from "./types";

const TODO_ID = "m-todo";
const NOTES_ID = "m-notes";

export const mockMissions: MissionDetail[] = [
  {
    id: TODO_ID,
    goal: "Add due dates and a filter for overdue items to the todo app",
    status: "running",
    created_at: "2026-11-16T14:00:00.000Z",
    repo: "examples/todo-app",
    units_total: 4,
    units_done: 1,
    units: [
      { id: "u1", title: "Due date field in the store", lane: "gated", wave: 1, needs: [] },
      { id: "u2", title: "Date formatting helpers", lane: "open", wave: 1, needs: [] },
      { id: "u3", title: "Overdue filter", lane: "open", wave: 2, needs: ["u1"] },
      { id: "u4", title: "Database migration for due dates", lane: "closed", wave: 2, needs: ["u1"] },
    ],
  },
  {
    id: NOTES_ID,
    goal: "Markdown preview for notes",
    status: "finished",
    created_at: "2026-11-15T09:30:00.000Z",
    repo: "examples/notes",
    units_total: 1,
    units_done: 1,
    units: [{ id: "u1", title: "Preview pane", lane: "open", wave: 1, needs: [] }],
  },
];

export function mockSummaries(): MissionSummary[] {
  return mockMissions.map(({ id, goal, status, created_at, units_total, units_done }) => ({
    id,
    goal,
    status,
    created_at,
    units_total,
    units_done,
  }));
}

export const mockQuestions: Question[] = [
  {
    id: "q1",
    mission_id: TODO_ID,
    unit_id: "u3",
    body: "Should an item due today count as overdue, or only items due before today?",
    status: "open",
    answer: null,
    source: null,
    briefing_ref: null,
    created_at: "2026-11-16T14:03:10.000Z",
    answered_at: null,
  },
  {
    id: "q2",
    mission_id: TODO_ID,
    unit_id: "u4",
    body: "Can the migration drop the unused `legacy_due` column, or must it stay?",
    status: "open",
    answer: null,
    source: null,
    briefing_ref: null,
    created_at: "2026-11-16T14:04:00.000Z",
    answered_at: null,
  },
  {
    id: "q3",
    mission_id: TODO_ID,
    unit_id: "u1",
    body: "Should due dates include a time?",
    status: "answered",
    answer: "Dates only, no time of day.",
    source: "briefing",
    briefing_ref: "Features",
    created_at: "2026-11-16T14:01:00.000Z",
    answered_at: "2026-11-16T14:01:07.000Z",
  },
  {
    id: "q4",
    mission_id: NOTES_ID,
    unit_id: "u1",
    body: "Which markdown flavour should the preview follow?",
    status: "answered",
    answer: "GitHub-flavoured markdown.",
    source: "human",
    briefing_ref: null,
    created_at: "2026-11-15T09:40:00.000Z",
    answered_at: "2026-11-15T10:02:00.000Z",
  },
];

/** A canned General reply. A goal containing "broken" returns validator errors instead of a plan. */
export function mockCreateMission(goal: string, repo: string): CreateMissionResponse {
  if (/broken/i.test(goal)) {
    return {
      ok: false,
      mission_id: null,
      attempts: 2,
      errors: [
        "fake edge: u3 waits for u1 but names nothing it reads",
        `locked path: u2 lists ${repo.replace(/\/$/, "")}/.bulletin/rules.md`,
      ],
    };
  }
  return {
    ok: true,
    mission_id: "m-new",
    attempts: 1,
    plan: {
      briefing_version: 1,
      units: [
        { id: "u1", title: "Data model", task: `Store what this needs: ${goal}`, files: ["src/store.ts", "test/store.test.ts"], needs: [], lane: "gated", tier: "station", acceptance: ["pnpm test"] },
        { id: "u2", title: "Helpers", task: "Pure helpers and their tests", files: ["src/helpers.ts", "test/helpers.test.ts"], needs: [], lane: "open", tier: "station", acceptance: ["pnpm test"] },
        { id: "u3", title: "Screen", task: "Show it in the UI", files: ["src/view.ts", "test/view.test.ts"], needs: [{ unit: "u1", reads: "the store's exported types" }, { unit: "u2", reads: "formatting helpers" }], lane: "open", tier: "station", acceptance: ["pnpm test"] },
      ],
    },
  };
}

/** The todo budget is small on purpose so the mock run crosses the 80% warning. */
export const mockTreasury: Record<string, TreasuryInfo> = {
  [TODO_ID]: { budget_cents: 16 },
  [NOTES_ID]: { budget_cents: 500 },
};

type Step = [type: EventType, unitId: string | null, payload?: Record<string, unknown>];

function build(missionId: string, steps: Step[]): BulletinEvent[] {
  const start = Date.parse("2026-11-16T14:00:00.000Z");
  return steps.map(([type, unitId, payload], i) => ({
    id: i + 1,
    mission_id: missionId,
    ts: new Date(start + i * 7_000).toISOString(),
    type,
    unit_id: unitId,
    payload: payload ?? {},
  }));
}

export const mockEvents: Record<string, BulletinEvent[]> = {
  [TODO_ID]: build(TODO_ID, [
    ["mission.created", null, { repo: "examples/todo-app", base: "main" }],
    ["plan.proposed", null, { units: 4, waves: 2 }],
    ["plan.approved", null],
    ["wave.started", null, { wave: 1, units: ["u1", "u2"] }],
    ["unit.started", "u1", { lane: "gated" }],
    ["attempt.started", "u1", { attempt: 1, tier: "station", model: "claude-sonnet-5-5" }],
    ["unit.started", "u2", { lane: "open" }],
    ["attempt.started", "u2", { attempt: 1, tier: "station", model: "claude-sonnet-5-5" }],
    ["dispatch.asked", "u1", { question: "Should due dates include a time?" }],
    ["dispatch.answered", "u1", { source: "briefing", briefing_ref: "Features" }],
    ["ledger.charged", "u2", { attempt: 1, model: "claude-sonnet-5-5", cost_cents: 4.2 }],
    ["pass.green", "u2", { attempt: 1, reason: "all checks passed" }],
    ["attempt.ended", "u2", { attempt: 1, result: "green" }],
    ["unit.merged", "u2", { attempt: 1 }],
    ["ledger.charged", "u1", { attempt: 1, model: "claude-sonnet-5-5", cost_cents: 6.1 }],
    [
      "pass.red",
      "u1",
      { attempt: 1, reason: "tests failed", evidence: "todos.test.ts > due date > keeps the date\n  expected '2026-11-20', got undefined\n  src/todos.ts:41" },
    ],
    ["attempt.ended", "u1", { attempt: 1, result: "red" }],
    [
      "unit.sent_back",
      "u1",
      {
        attempt: 1,
        reason: "tests failed",
        packet:
          "UNIT      u1\nVERDICT   RED (attempt 1 of 3)\nREASON    tests failed\nEVIDENCE  expected '2026-11-20', got undefined\n          src/todos.ts:41\nSCOPE     fix this unit only. Touch only: src/todos.ts, test/todos.test.ts",
      },
    ],
    ["attempt.started", "u1", { attempt: 2, tier: "station", model: "claude-sonnet-5-5" }],
    ["ledger.charged", "u1", { attempt: 2, model: "claude-sonnet-5-5", cost_cents: 3.5 }],
    ["pass.green", "u1", { attempt: 2, reason: "all checks passed" }],
    ["attempt.ended", "u1", { attempt: 2, result: "green" }],
    ["unit.held", "u1", { lane: "gated", attempt: 2, branch: "bulletin/m-todo/u1-a2" }],
    ["decision.opened", "u1", { kind: "gated_retry", branch: "bulletin/m-todo/u1-a2" }],
  ]),
  [NOTES_ID]: build(NOTES_ID, [
    ["mission.created", null, { repo: "examples/notes", base: "main" }],
    ["plan.approved", null],
    ["unit.started", "u1", { lane: "open" }],
    ["attempt.started", "u1", { attempt: 1, tier: "station", model: "claude-sonnet-5-5" }],
    ["pass.green", "u1", { attempt: 1, reason: "all checks passed" }],
    ["unit.merged", "u1", { attempt: 1 }],
    ["mission.finished", null, { shipped: 1, held: 0, failed: 0 }],
  ]),
};
