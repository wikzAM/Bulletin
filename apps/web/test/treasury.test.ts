import { describe, expect, it } from "vitest";
import type { BulletinEvent, EventType } from "@bulletin/core";
import { summarizeTreasury, WARNING_RATIO } from "../lib/treasury";
import { reduceEvents } from "../lib/war-table";
import type { PlannedUnit } from "../lib/types";

const units: PlannedUnit[] = [
  { id: "u1", title: "Store", lane: "open", wave: 1, needs: [] },
  { id: "u2", title: "Helpers", lane: "open", wave: 1, needs: [] },
  { id: "u3", title: "Filter", lane: "open", wave: 2, needs: [] },
];

let nextId = 1;
function ev(type: EventType, unitId: string | null, payload: Record<string, unknown> = {}): BulletinEvent {
  return { id: nextId++, mission_id: "m1", ts: "2026-11-16T14:00:00.000Z", type, unit_id: unitId, payload };
}

function charged(...charges: [string, number][]) {
  return reduceEvents(units, charges.map(([u, c]) => ev("ledger.charged", u, { cost_cents: c })));
}

describe("summarizeTreasury", () => {
  it("warns above 80 percent of the budget", () => {
    expect(WARNING_RATIO).toBe(0.8);
  });

  it("totals spend across units and lists units by spend, highest first, skipping units with none", () => {
    const s = summarizeTreasury(charged(["u1", 3], ["u2", 7], ["u1", 1.5]), { budget_cents: 100 });
    expect(s.spent_cents).toBeCloseTo(11.5);
    expect(s.units.map((u) => [u.id, u.title])).toEqual([["u2", "Helpers"], ["u1", "Store"]]);
    expect(s.units[1]?.spent_cents).toBeCloseTo(4.5);
  });

  it("is ok at or under 80 percent", () => {
    const s = summarizeTreasury(charged(["u1", 80]), { budget_cents: 100 });
    expect(s).toMatchObject({ level: "ok", remaining_cents: 20 });
    expect(s.ratio).toBeCloseTo(0.8);
  });

  it("warns above 80 percent, up to and including the whole budget", () => {
    expect(summarizeTreasury(charged(["u1", 80.5]), { budget_cents: 100 }).level).toBe("warning");
    expect(summarizeTreasury(charged(["u1", 100]), { budget_cents: 100 }).level).toBe("warning");
  });

  it("is over when spend exceeds the budget, and remaining never goes negative", () => {
    const s = summarizeTreasury(charged(["u1", 120]), { budget_cents: 100 });
    expect(s).toMatchObject({ level: "over", remaining_cents: 0 });
  });

  it("has no level without a budget", () => {
    const s = summarizeTreasury(charged(["u1", 5]), null);
    expect(s).toMatchObject({ level: "unknown", budget_cents: null, ratio: null, remaining_cents: null });
    expect(s.spent_cents).toBe(5);
  });

  it("treats a zero budget as no budget rather than dividing by zero", () => {
    expect(summarizeTreasury(charged(), { budget_cents: 0 }).level).toBe("unknown");
  });

  it("reports a pause from budget.paused until the next attempt starts", () => {
    const paused = reduceEvents(units, [ev("budget.paused", null)]);
    expect(summarizeTreasury(paused, { budget_cents: 100 }).paused).toBe(true);
    const resumed = reduceEvents(units, [ev("budget.paused", null), ev("attempt.started", "u1", { attempt: 1 })]);
    expect(summarizeTreasury(resumed, { budget_cents: 100 }).paused).toBe(false);
  });
});
