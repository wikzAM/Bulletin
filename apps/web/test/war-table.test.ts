import { describe, expect, it } from "vitest";
import type { BulletinEvent, EventType } from "@bulletin/core";
import { applyEvent, describeEvent, initialState, reduceEvents } from "../lib/war-table";
import type { PlannedUnit } from "../lib/types";

const units: PlannedUnit[] = [
  { id: "u1", title: "Store", lane: "gated", wave: 1, needs: [] },
  { id: "u2", title: "Helpers", lane: "open", wave: 1, needs: [] },
  { id: "u3", title: "Filter", lane: "open", wave: 2, needs: ["u1"] },
];

let nextId = 1;
function ev(type: EventType, unitId: string | null = null, payload: Record<string, unknown> = {}): BulletinEvent {
  const id = nextId++;
  return { id, mission_id: "m1", ts: `2026-11-16T14:00:${String(id % 60).padStart(2, "0")}.000Z`, type, unit_id: unitId, payload };
}

describe("initialState", () => {
  it("starts every planned unit as pending with no attempts, in plan order", () => {
    const s = initialState(units);
    expect(s.order).toEqual(["u1", "u2", "u3"]);
    expect(s.units.u1).toMatchObject({ title: "Store", lane: "gated", wave: 1, status: "pending", attempts: 0, spent_cents: 0, last_reason: null, started: false });
    expect(s.lastEventId).toBe(0);
    expect(s.feed).toEqual([]);
    expect(s.finished).toBe(false);
  });
});

describe("applyEvent", () => {
  it("marks a unit running and started on unit.started", () => {
    const s = reduceEvents(units, [ev("unit.started", "u1", { lane: "gated" })]);
    expect(s.units.u1).toMatchObject({ status: "running", started: true });
    expect(s.units.u2?.status).toBe("pending");
  });

  it("counts attempts from attempt.started", () => {
    const s = reduceEvents(units, [
      ev("unit.started", "u1"),
      ev("attempt.started", "u1", { attempt: 1 }),
      ev("pass.red", "u1", { attempt: 1, reason: "tests failed" }),
      ev("unit.sent_back", "u1", { attempt: 1, reason: "tests failed" }),
      ev("attempt.started", "u1", { attempt: 2 }),
    ]);
    expect(s.units.u1).toMatchObject({ status: "running", attempts: 2, last_reason: "tests failed" });
  });

  it("increments attempts when the payload has no attempt number", () => {
    const s = reduceEvents(units, [ev("attempt.started", "u2"), ev("attempt.started", "u2")]);
    expect(s.units.u2?.attempts).toBe(2);
  });

  it("follows a unit through green to merged", () => {
    const s = reduceEvents(units, [
      ev("unit.started", "u2"),
      ev("attempt.started", "u2", { attempt: 1 }),
      ev("pass.green", "u2", { attempt: 1, reason: "all checks passed" }),
    ]);
    expect(s.units.u2?.status).toBe("green");
    expect(applyEvent(s, ev("unit.merged", "u2", { attempt: 1 })).units.u2?.status).toBe("merged");
  });

  it("maps pass.red, held, failed and blocked to their statuses", () => {
    expect(reduceEvents(units, [ev("pass.red", "u1", { reason: "out of scope" })]).units.u1).toMatchObject({ status: "red", last_reason: "out of scope" });
    expect(reduceEvents(units, [ev("unit.held", "u1", { lane: "gated" })]).units.u1?.status).toBe("held");
    expect(reduceEvents(units, [ev("unit.failed", "u1", { reason: "tests failed" })]).units.u1).toMatchObject({ status: "failed", last_reason: "tests failed" });
    expect(reduceEvents(units, [ev("unit.blocked", "u3", { waits_on: "u1" })]).units.u3?.status).toBe("blocked");
  });

  it("adds up ledger charges per unit", () => {
    const s = reduceEvents(units, [
      ev("ledger.charged", "u1", { cost_cents: 4.2 }),
      ev("ledger.charged", "u1", { cost_cents: 1.3 }),
      ev("ledger.charged", "u2", { cost_cents: "not a number" }),
    ]);
    expect(s.units.u1?.spent_cents).toBeCloseTo(5.5);
    expect(s.units.u2?.spent_cents).toBe(0);
  });

  it("takes the lane from unit.started when the payload names a valid one", () => {
    const s = reduceEvents(units, [ev("unit.started", "u2", { lane: "closed" }), ev("unit.started", "u3", { lane: "bogus" })]);
    expect(s.units.u2?.lane).toBe("closed");
    expect(s.units.u3?.lane).toBe("open");
  });

  it("adds a card for a unit the plan did not list", () => {
    const s = reduceEvents(units, [ev("unit.started", "u9", { lane: "open" })]);
    expect(s.order).toEqual(["u1", "u2", "u3", "u9"]);
    expect(s.units.u9).toMatchObject({ title: "u9", status: "running", wave: 0 });
  });

  it("ignores an event it has already seen, so a reconnect cannot double count", () => {
    const charge = ev("ledger.charged", "u1", { cost_cents: 2 });
    const once = reduceEvents(units, [charge]);
    const twice = applyEvent(once, charge);
    expect(twice).toBe(once);
    expect(twice.units.u1?.spent_cents).toBe(2);
  });

  it("does not mutate the previous state", () => {
    const before = initialState(units);
    const after = applyEvent(before, ev("unit.started", "u1"));
    expect(before.units.u1?.status).toBe("pending");
    expect(before.feed).toEqual([]);
    expect(after).not.toBe(before);
  });

  it("records every event in the feed, oldest first, and tracks the last id", () => {
    const a = ev("plan.approved");
    const b = ev("unit.started", "u1");
    const s = reduceEvents(units, [a, b]);
    expect(s.feed.map((f) => f.id)).toEqual([a.id, b.id]);
    expect(s.feed[1]).toMatchObject({ ts: b.ts, unit_id: "u1", type: "unit.started" });
    expect(s.lastEventId).toBe(b.id);
  });

  it("caps the feed at the newest 200 entries", () => {
    const events = Array.from({ length: 250 }, () => ev("dispatch.posted", "u1"));
    const s = reduceEvents(units, events);
    expect(s.feed).toHaveLength(200);
    expect(s.feed[0]?.id).toBe(events[50]?.id);
  });

  it("marks the mission finished on mission.finished", () => {
    expect(reduceEvents(units, [ev("mission.finished", null, { shipped: 1 })]).finished).toBe(true);
  });

  it("takes titles, lanes and batches from a plan in plan.proposed, keeping live state", () => {
    const known = [{ id: "seed", title: "seed", lane: "open" as const, wave: 0, needs: [] }];
    const plan = {
      briefing_version: 1,
      units: [
        { id: "seed", title: "Seed the demo", task: "t", files: ["a"], needs: [], lane: "gated", tier: "station", acceptance: [] },
        { id: "view", title: "Show it", task: "t", files: ["b"], needs: [{ unit: "seed", reads: "types" }], lane: "open", tier: "station", acceptance: [] },
      ],
    };
    const s = reduceEvents(known, [ev("ledger.charged", "seed", { cost_cents: 2 }), ev("plan.proposed", null, { units: 2, plan })]);
    expect(s.order).toEqual(["seed", "view"]);
    expect(s.units.seed).toMatchObject({ title: "Seed the demo", lane: "gated", wave: 1, spent_cents: 2 });
    expect(s.units.view).toMatchObject({ title: "Show it", lane: "open", wave: 2, status: "pending" });
  });

  it("ignores a plan.proposed payload without a usable plan", () => {
    const s = reduceEvents(units, [ev("plan.proposed", null, { units: 4, waves: 2 }), ev("plan.proposed", null, { plan: { units: "nope" } })]);
    expect(s.order).toEqual(["u1", "u2", "u3"]);
    expect(s.units.u1?.title).toBe("Store");
  });

  it("ignores unit events with no unit id", () => {
    const s = reduceEvents(units, [ev("unit.merged", null)]);
    expect(s.order).toEqual(["u1", "u2", "u3"]);
    expect(s.feed).toHaveLength(1);
  });
});

describe("describeEvent", () => {
  const titles = { u1: "Store" };

  it("uses the unit title and plain language", () => {
    expect(describeEvent(ev("unit.started", "u1"), titles)).toBe("Store: work started");
    expect(describeEvent(ev("attempt.started", "u1", { attempt: 2 }), titles)).toBe("Store: try 2 started");
    expect(describeEvent(ev("pass.red", "u1", { reason: "tests failed" }), titles)).toBe("Store: checks failed (tests failed)");
    expect(describeEvent(ev("unit.merged", "u1"), titles)).toBe("Store: done and merged");
  });

  it("falls back to the unit id when the title is unknown", () => {
    expect(describeEvent(ev("unit.held", "u7"), titles)).toBe("u7: waiting for approval");
  });

  it("describes mission-level events without a unit", () => {
    expect(describeEvent(ev("plan.approved"), titles)).toBe("Plan approved");
    expect(describeEvent(ev("wave.started", null, { wave: 2 }), titles)).toBe("Batch 2 started");
  });

  it("formats ledger charges in cents", () => {
    expect(describeEvent(ev("ledger.charged", "u1", { cost_cents: 4.25 }), titles)).toBe("Store: spent 4.25¢");
  });

  it("has a description for every event type", () => {
    const types: EventType[] = [
      "mission.created", "briefing.versioned", "plan.proposed", "plan.approved", "wave.started", "unit.started",
      "attempt.started", "attempt.ended", "dispatch.asked", "dispatch.answered", "dispatch.escalated", "dispatch.posted",
      "decision.opened", "decision.resolved", "pass.green", "pass.red", "unit.sent_back", "unit.merged", "unit.held",
      "unit.failed", "unit.blocked", "ledger.charged", "budget.paused", "mission.finished",
    ];
    for (const type of types) {
      const text = describeEvent(ev(type, null), titles);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("undefined");
    }
  });
});
