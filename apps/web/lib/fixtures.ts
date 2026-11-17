import type { BulletinEvent, EventType } from "@bulletin/core";
import type { PlannedUnit, TreasuryInfo } from "./types";
import { reduceEvents, type WarTableState } from "./war-table";

/** Fixed project states for /demo and for tests of the view logic; no API needed. */
export type DemoScenarioId = "running" | "held" | "sent-back" | "over-budget" | "paused" | "stopped" | "interrupted";

export interface DemoScenario {
  id: DemoScenarioId;
  units: PlannedUnit[];
  events: BulletinEvent[];
  treasury: TreasuryInfo;
}

type Step = [type: EventType, unitId: string | null, payload?: Record<string, unknown>];

const MISSION = "demo";

const UNITS: PlannedUnit[] = [
  { id: "store", title: "Save due dates", lane: "gated", wave: 1, needs: [] },
  { id: "dates", title: "Date helpers", lane: "open", wave: 1, needs: [] },
  { id: "list", title: "Show due dates in the list", lane: "open", wave: 2, needs: ["store", "dates"] },
  { id: "overdue", title: "Overdue filter", lane: "closed", wave: 2, needs: ["store", "dates"] },
];

function build(steps: Step[]): BulletinEvent[] {
  const start = Date.parse("2026-11-16T14:00:00.000Z");
  return steps.map(([type, unitId, payload], i) => ({
    id: i + 1,
    mission_id: MISSION,
    ts: new Date(start + i * 9_000).toISOString(),
    type,
    unit_id: unitId,
    payload: payload ?? {},
  }));
}

const opening: Step[] = [
  ["mission.created", null, { repo: "examples/todo-app", base: "main" }],
  ["plan.proposed", null, { units: 4, waves: 2 }],
  ["plan.approved", null],
  ["wave.started", null, { wave: 1 }],
];

const tryOnce = (unit: string, cents: number, attempt = 1): Step[] => [
  ["attempt.started", unit, { attempt }],
  ["ledger.charged", unit, { attempt, cost_cents: cents }],
  ["pass.green", unit, { attempt }],
  ["attempt.ended", unit, { attempt, result: "green" }],
];

const firstBatchDone: Step[] = [
  ...opening,
  ["unit.started", "store"],
  ["unit.started", "dates"],
  ...tryOnce("store", 14),
  ...tryOnce("dates", 9),
  ["unit.merged", "store"],
  ["unit.merged", "dates"],
  ["wave.started", null, { wave: 2 }],
];

const SENT_BACK_EVIDENCE = "FAIL test/list.test.ts > shows the due date\n  expected '16 Nov' to be 'Nov 16'";
const SENT_BACK_PACKET = "Dates must use the 'Nov 16' format from the requirements. Use formatDue() from the date helpers instead of toLocaleDateString.";

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "running",
    units: UNITS,
    treasury: { budget_cents: 500 },
    events: build([
      ...opening,
      ["unit.started", "store"],
      ["unit.started", "dates"],
      ...tryOnce("dates", 9),
      ["unit.merged", "dates"],
      ["attempt.started", "store", { attempt: 1 }],
      ["ledger.charged", "store", { attempt: 1, cost_cents: 6 }],
    ]),
  },
  {
    id: "held",
    units: UNITS,
    treasury: { budget_cents: 500 },
    events: build([
      ...firstBatchDone,
      ["unit.started", "list"],
      ["unit.started", "overdue"],
      ...tryOnce("overdue", 21),
      ["unit.held", "overdue", { reason: "needs approval before merging" }],
      ["attempt.started", "list", { attempt: 1 }],
      ["ledger.charged", "list", { attempt: 1, cost_cents: 7 }],
    ]),
  },
  {
    id: "sent-back",
    units: UNITS,
    treasury: { budget_cents: 500 },
    events: build([
      ...firstBatchDone,
      ["unit.started", "list"],
      ["attempt.started", "list", { attempt: 1 }],
      ["ledger.charged", "list", { attempt: 1, cost_cents: 18 }],
      ["pass.red", "list", { attempt: 1, reason: "1 test failed", evidence: SENT_BACK_EVIDENCE }],
      ["attempt.ended", "list", { attempt: 1, result: "red" }],
      ["unit.sent_back", "list", { attempt: 1, reason: "1 test failed", packet: SENT_BACK_PACKET }],
      ["attempt.started", "list", { attempt: 2 }],
      ["ledger.charged", "list", { attempt: 2, cost_cents: 5 }],
    ]),
  },
  {
    id: "over-budget",
    units: UNITS,
    treasury: { budget_cents: 50 },
    events: build([
      ...firstBatchDone,
      ["unit.started", "list"],
      ...tryOnce("list", 19),
      ["unit.merged", "list"],
      ["unit.started", "overdue"],
      ["attempt.started", "overdue", { attempt: 1 }],
      ["ledger.charged", "overdue", { attempt: 1, cost_cents: 16 }],
    ]),
  },
  {
    id: "paused",
    units: UNITS,
    treasury: { budget_cents: 50 },
    events: build([
      ...firstBatchDone,
      ["unit.started", "list"],
      ["attempt.started", "list", { attempt: 1 }],
      ["ledger.charged", "list", { attempt: 1, cost_cents: 19 }],
      ["pass.red", "list", { attempt: 1, reason: "type check failed", evidence: "src/list.tsx(12,7): error TS2322" }],
      ["attempt.ended", "list", { attempt: 1, result: "red" }],
      ["budget.paused", null, { spent_cents: 42, budget_cents: 50 }],
    ]),
  },
  {
    id: "stopped",
    units: UNITS,
    treasury: { budget_cents: 500 },
    events: build([
      ...firstBatchDone,
      ["unit.started", "list"],
      ["attempt.started", "list", { attempt: 1 }],
      ["ledger.charged", "list", { attempt: 1, cost_cents: 7 }],
      ["attempt.ended", "list", { attempt: 1, result: "cancelled" }],
      ["mission.finished", null, { stopped: true }],
    ]),
  },
  {
    id: "interrupted",
    units: UNITS,
    treasury: { budget_cents: 500 },
    events: build([
      ...firstBatchDone,
      ["unit.started", "list"],
      ["attempt.started", "list", { attempt: 1 }],
      ["mission.finished", null, { interrupted: true }],
    ]),
  },
];

export function demoScenario(id: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.id === id);
}

export function demoState(scenario: DemoScenario): WarTableState {
  return reduceEvents(scenario.units, scenario.events);
}
