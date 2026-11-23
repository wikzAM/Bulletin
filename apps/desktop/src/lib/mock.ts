import type { BulletinEvent, EventType } from "@bulletin/core";
import models from "../../../../config/models.json";
import prices from "../../../../config/prices.json";
import type { BriefingReply } from "./api-adapters";
import { briefingFromGoal, briefingGoal } from "./interview";
import type { ApproveResult, CreateMissionResponse, MissionDetail, MissionSummary, Question, ResolveResult, ReviseResult, StopResult, TreasuryInfo } from "./types";

const TODO_ID = "m-todo";
const NOTES_ID = "m-notes";
const SEARCH_ID = "m-search";

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
  {
    id: SEARCH_ID,
    goal: "Search across all notes",
    status: "planning",
    created_at: "2026-11-17T08:10:00.000Z",
    repo: "examples/notes",
    units_total: 3,
    units_done: 0,
    units: [
      { id: "u1", title: "Search index", lane: "gated", wave: 1, needs: [] },
      { id: "u2", title: "Search box", lane: "open", wave: 2, needs: ["u1"] },
      { id: "u3", title: "Highlight matches", lane: "open", wave: 2, needs: ["u1"] },
    ],
  },
];

/** Rough per-task estimate for the mock cost guard. */
const MOCK_TASK_ESTIMATE_CENTS = 15;

/** Mirrors POST /missions/:id/approve: refuses when the estimate is over budget, otherwise starts. */
const mockRevised = new Set<string>();

/** Sample data cannot re-plan: it records the one allowed revision and returns the tasks unchanged. */
export function mockReviseMission(id: string, comment: string): ReviseResult {
  void comment;
  const mission = mockMissions.find((m) => m.id === id);
  if (!mission) return { ok: false, reason: "not_found" };
  if (mission.status !== "planning") return { ok: false, reason: "closed" };
  if (mockRevised.has(id)) return { ok: false, reason: "already" };
  mockRevised.add(id);
  return { ok: true, units: mission.units };
}

export function mockApproveMission(id: string): ApproveResult {
  const mission = mockMissions.find((m) => m.id === id);
  if (!mission) return { ok: false, reason: "not_found" };
  if (mission.status !== "planning") return { ok: false, reason: "already" };
  const budget = mockTreasury[id]?.budget_cents ?? null;
  const estimate = mission.units.length * MOCK_TASK_ESTIMATE_CENTS;
  if (budget !== null && estimate > budget) {
    return { ok: false, reason: "over_budget", budget_cents: budget, estimated_cents: estimate, spent_cents: 0, shortfall_cents: estimate - budget };
  }
  mission.status = "running";
  return { ok: true };
}

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
    auto_result: "silent",
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
    auto_result: "contradiction",
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
    auto_result: null,
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
    auto_result: null,
    created_at: "2026-11-15T09:40:00.000Z",
    answered_at: "2026-11-15T10:02:00.000Z",
  },
];

/** Asked one at a time, like the API; the section each answer fills in the Briefing template. */
const MOCK_INTERVIEW = [
  { text: "Who will use this, and what do they need from it?", section: "## Users" },
  { text: "Which features matter most, and how would you check that each one works?", section: "## Features" },
  { text: "Any limits to respect: stack, hosting, deadline or budget?", section: "## Constraints" },
  { text: "Is there anything it should not do?", section: "## Out of scope" },
];

const mockInterviews = new Map<string, { goal: string; answers: (string | null)[] }>();

function mockQuestion(briefingId: string, n: number): BriefingReply {
  const q = MOCK_INTERVIEW[n - 1];
  return q ? { kind: "questions", briefingId, questions: [{ id: String(n), text: q.text }] } : { kind: "questions", briefingId, questions: [] };
}

export function mockStartBriefing(goal: string): BriefingReply {
  const briefingId = `b-${mockInterviews.size + 1}`;
  mockInterviews.set(briefingId, { goal, answers: [] });
  return mockQuestion(briefingId, 1);
}

/** The spec's Briefing template filled from the goal and the answers in order; skipped questions leave a section empty. */
export function mockBriefingMarkdown(goal: string, answers: (string | null)[]): string {
  const bySection = new Map(MOCK_INTERVIEW.map((q, i) => [q.section, answers[i] ?? null]));
  const lines = briefingFromGoal(goal).trimEnd().split("\n");
  return `${lines.flatMap((line) => {
    const answer = bySection.get(line);
    return answer ? [line, answer] : [line];
  }).join("\n")}\n`;
}

export function mockAnswerBriefing(briefingId: string, questionId: string, answer: string | null): BriefingReply {
  const interview = mockInterviews.get(briefingId) ?? { goal: "", answers: [] };
  if (Number(questionId) === interview.answers.length + 1) interview.answers.push(answer);
  mockInterviews.set(briefingId, interview);
  const next = interview.answers.length + 1;
  if (next <= MOCK_INTERVIEW.length) return mockQuestion(briefingId, next);
  return { kind: "briefing", briefingId, markdown: mockBriefingMarkdown(interview.goal, interview.answers) };
}
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
        { id: "u1", title: "Data model", task: `Store what this needs: ${briefingGoal(goal)}`, files: ["src/store.ts", "test/store.test.ts"], needs: [], lane: "gated", tier: "station", acceptance: ["pnpm test"] },
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
  /** Below the mock estimate, so approving shows the cost guard. */
  [SEARCH_ID]: { budget_cents: 30 },
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
  [SEARCH_ID]: build(SEARCH_ID, [
    ["mission.created", null, { repo: "examples/notes", base: "main", budget_cents: 30 }],
    ["plan.proposed", null, { units: 3, waves: 2 }],
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

/** The GET /config body. Model names come from config/; the lanes copy DEFAULT_LANES (a test keeps them equal). */
export function mockSettings(): unknown {
  return {
    roles: models.roles,
    tiers: models.tiers,
    lanes: {
      closed: ["**/migrations/**", "**/*migration*", "**/*payment*", "infra/**", "**/*.env*", "**/*secret*"],
      gated: ["**/package.json", "**/pnpm-lock.yaml", "**/package-lock.json", "**/shared/**", "**/db/**", "**/*schema*"],
    },
    priced_models: Object.keys(prices.models).sort(),
    limits: { default_budget_cents: 500, unit_allowance_cents: 200 },
  };
}

/** Spend for one mock project: its ledger.charged costs and its mock budget. */
export function mockSpend(id: string): { spent_cents: number; budget_cents: number | null } | null {
  if (!mockMissions.some((m) => m.id === id)) return null;
  const spent = (mockEvents[id] ?? [])
    .filter((e) => e.type === "ledger.charged")
    .reduce((sum, e) => sum + (typeof e.payload.cost_cents === "number" ? e.payload.cost_cents : 0), 0);
  return { spent_cents: spent, budget_cents: mockTreasury[id]?.budget_cents ?? null };
}
const resolvedMock = new Set<string>();

/** Mock mode records the choice in memory; the replayed stream does not change. */
export function mockResolveDecision(missionId: string, unitId: string, _choice: "approve" | "reject"): ResolveResult {
  const open = (mockEvents[missionId] ?? []).some((e) => e.type === "decision.opened" && e.unit_id === unitId);
  if (!open) return { ok: false, reason: "not_found" };
  const key = `${missionId}/${unitId}`;
  if (resolvedMock.has(key)) return { ok: false, reason: "already" };
  resolvedMock.add(key);
  return { ok: true };
}
const LESSONS_HEADER = "# Lessons\n\nOne line per send-back.\n";
const RULES_HEADER = "# Rules\n\nRules about how to cut units, promoted from lessons.md.\n";

/** .bulletin/rules.md and lessons.md as the engine writes them (packages/graph send-back.ts). */
const mockRuleFiles: Record<string, { rules: string; lessons: string }> = {
  [TODO_ID]: {
    rules: `${RULES_HEADER}- Keep database migrations in a task of their own\n- Cut units so this cannot recur: missing a test for the empty list\n`,
    lessons: `${LESSONS_HEADER}- missing a test for the empty list (list: Todo list view)\n- missing a test for the empty list (done-filter: Done filter)\n- tests failed (u1: Due date field in the store)\n`,
  },
  [NOTES_ID]: { rules: RULES_HEADER, lessons: LESSONS_HEADER },
  [SEARCH_ID]: { rules: RULES_HEADER, lessons: LESSONS_HEADER },
};

export function mockRules(id: string): { rules: string; lessons: string } | null {
  return mockRuleFiles[id] ?? null;
}
const stoppedMock = new Set<string>();

/** Mock mode answers like POST /missions/:id/stop; the replayed stream does not change. */
export function mockStopMission(id: string): StopResult {
  const mission = mockMissions.find((m) => m.id === id);
  if (!mission) return { ok: false, reason: "not_found" };
  if (mission.status !== "running" || stoppedMock.has(id)) return { ok: false, reason: "not_running" };
  stoppedMock.add(id);
  return { ok: true };
}