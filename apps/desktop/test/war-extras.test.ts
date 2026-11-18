import { describe, expect, it } from "vitest";
import type { BulletinEvent, EventType } from "@bulletin/core";
import { prefersReducedMotion, activeCouriers, missionReceipt } from "../src/lib/war-extras";
import type { PlannedUnit } from "../src/lib/types";
import { reduceEvents } from "../src/lib/war-table";

const units: PlannedUnit[] = [
  { id: "store", title: "Store", lane: "open", wave: 1, needs: [] },
  { id: "list", title: "List", lane: "open", wave: 2, needs: ["store"] },
];

let nextId = 1;
function ev(type: EventType, unitId: string | null, payload: Record<string, unknown> = {}): BulletinEvent {
  return { id: nextId++, mission_id: "m1", ts: "2026-11-18T12:00:00.000Z", type, unit_id: unitId, payload };
}

describe("prefersReducedMotion", () => {
  it("reads the media query when window is available", () => {
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });
});

describe("activeCouriers", () => {
  it("opens a courier on dispatch.asked and closes it on dispatch.answered for the same unit", () => {
    const asked = reduceEvents(units, [ev("dispatch.asked", "store", { question_id: "q1" })]);
    expect(activeCouriers(asked)).toEqual([{ unitId: "store", direction: "to-hq", questionId: "q1" }]);
    const answered = reduceEvents(units, [
      ev("dispatch.asked", "store", { question_id: "q1" }),
      ev("dispatch.answered", "store", { question_id: "q1" }),
    ]);
    expect(activeCouriers(answered)).toEqual([]);
  });
});

describe("missionReceipt", () => {
  it("is null until the project finishes, then summarizes shipped work and spend", () => {
    const running = reduceEvents(units, [ev("plan.approved", null), ev("unit.started", "store")]);
    expect(missionReceipt(running)).toBeNull();

    const done = reduceEvents(units, [
      ev("plan.approved", null),
      ev("unit.started", "store"),
      ev("attempt.started", "store", { attempt: 1 }),
      ev("ledger.charged", "store", { attempt: 1, cost_cents: 12 }),
      ev("pass.green", "store", { attempt: 1 }),
      ev("unit.merged", "store"),
      ev("mission.finished", null, { shipped: 1, held: 0, failed: 0, blocked: 1, touches: 0 }),
    ]);
    expect(missionReceipt(done)).toEqual({
      shipped: 1,
      held: 0,
      failed: 0,
      blocked: 1,
      touches: 0,
      spent_cents: 12,
      ending: "done",
    });
  });
});
