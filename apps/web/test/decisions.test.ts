import { describe, expect, it } from "vitest";
import type { BulletinEvent, EventType } from "@bulletin/core";
import { toResolveResult } from "../lib/api-adapters";
import { heldForYou, resolveMessage } from "../lib/decisions";
import { mockEvents, mockResolveDecision } from "../lib/mock";
import type { PlannedUnit } from "../lib/types";
import { describeEvent, reduceEvents } from "../lib/war-table";

const units: PlannedUnit[] = [
  { id: "api", title: "Payments API", lane: "closed", wave: 1, needs: [] },
  { id: "store", title: "Store", lane: "gated", wave: 1, needs: [] },
  { id: "list", title: "List", lane: "open", wave: 2, needs: [] },
];

let nextId = 1;
function ev(type: EventType, unitId: string | null, payload: Record<string, unknown> = {}): BulletinEvent {
  return { id: nextId++, mission_id: "m1", ts: "2026-11-17T08:00:00.000Z", type, unit_id: unitId, payload };
}

const held = [
  ev("unit.held", "api", { lane: "closed", attempt: 1, branch: "bulletin/m1/api-a1" }),
  ev("decision.opened", "api", { kind: "closed_lane_merge", branch: "bulletin/m1/api-a1" }),
  ev("unit.held", "store", { lane: "gated", attempt: 2, branch: "bulletin/m1/store-a2" }),
  ev("decision.opened", "store", { kind: "gated_retry", branch: "bulletin/m1/store-a2" }),
];

describe("decisions in the reducer", () => {
  it("records the open decision on the task, with its kind and branch", () => {
    const s = reduceEvents(units, held);
    expect(s.units.api?.decision).toEqual({ kind: "closed_lane_merge", branch: "bulletin/m1/api-a1", choice: null });
    expect(s.units.store?.decision).toMatchObject({ kind: "gated_retry", choice: null });
    expect(s.units.list?.decision).toBeNull();
  });

  it("records the choice from decision.resolved", () => {
    const s = reduceEvents(units, [...held, ev("decision.resolved", "store", { choice: "reject" })]);
    expect(s.units.store?.decision?.choice).toBe("reject");
  });

  it("ignores question decisions, which belong on the questions page", () => {
    const s = reduceEvents(units, [ev("decision.opened", "list", { kind: "question", question_id: "q1" })]);
    expect(s.units.list?.decision).toBeNull();
  });

  it("says what was decided in the activity feed", () => {
    const titles = { store: "Store" };
    expect(describeEvent({ type: "decision.resolved", unit_id: "store", payload: { choice: "approve" } }, titles)).toBe("Store: approved");
    expect(describeEvent({ type: "decision.resolved", unit_id: "store", payload: { choice: "reject" } }, titles)).toBe("Store: rejected");
  });
});

describe("heldForYou", () => {
  it("lists held tasks still waiting, with a plain reason", () => {
    const items = heldForYou(reduceEvents(units, held), {});
    expect(items).toEqual([
      { id: "api", title: "Payments API", why: "It changes files that always need approval.", branch: "bulletin/m1/api-a1", choice: null },
      { id: "store", title: "Store", why: "It passed its checks, but only after a retry.", branch: "bulletin/m1/store-a2", choice: null },
    ]);
  });

  it("includes a held task even when no decision event arrived, using its lane for the reason", () => {
    const items = heldForYou(reduceEvents(units, [ev("unit.held", "api", { lane: "closed" })]), {});
    expect(items).toEqual([{ id: "api", title: "Payments API", why: "It changes files that always need approval.", branch: null, choice: null }]);
  });

  it("shows the choice made here or in the log", () => {
    const s = reduceEvents(units, [...held, ev("decision.resolved", "api", { choice: "approve" })]);
    const items = heldForYou(s, { store: "reject" });
    expect(items.map((i) => [i.id, i.choice])).toEqual([
      ["api", "approve"],
      ["store", "reject"],
    ]);
  });
});

describe("toResolveResult", () => {
  it("is ok for 2xx", () => {
    expect(toResolveResult(200, { mission_id: "m1", unit_id: "store", choice: "approve" })).toEqual({ ok: true });
    expect(toResolveResult(202, null)).toEqual({ ok: true });
  });

  it("names the refusals", () => {
    expect(toResolveResult(409, { error: "Decision already resolved" })).toEqual({ ok: false, reason: "already" });
    expect(toResolveResult(404, { error: "Decision not found" })).toEqual({ ok: false, reason: "not_found" });
    expect(toResolveResult(404, { error: "Mission not found" })).toEqual({ ok: false, reason: "not_found" });
    expect(toResolveResult(404, { error: "Route not found" })).toEqual({ ok: false, reason: "unavailable" });
    expect(toResolveResult(405, null)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("throws on anything else", () => {
    expect(() => toResolveResult(500, { error: "Internal server error" })).toThrow();
  });
});

describe("resolveMessage", () => {
  it("is honest that approving only records the choice for now", () => {
    expect(resolveMessage("approve", { ok: true })).toEqual({ tone: "ok", text: expect.stringContaining("saved") });
    expect(resolveMessage("reject", { ok: true }).tone).toBe("ok");
    expect(resolveMessage("approve", { ok: false, reason: "already" }).tone).toBe("ok");
    expect(resolveMessage("approve", { ok: false, reason: "unavailable" }).tone).toBe("error");
  });
});

describe("mock decisions", () => {
  it("resolves an open mock decision once, then reports it as already decided", () => {
    const [missionId, events] = Object.entries(mockEvents).find(([, list]) => list.some((e) => e.type === "decision.opened")) ?? [];
    const unitId = events?.find((e) => e.type === "decision.opened")?.unit_id;
    expect(missionId && unitId).toBeTruthy();
    expect(mockResolveDecision(missionId!, unitId!, "approve")).toEqual({ ok: true });
    expect(mockResolveDecision(missionId!, unitId!, "approve")).toEqual({ ok: false, reason: "already" });
    expect(mockResolveDecision(missionId!, "nope", "reject")).toEqual({ ok: false, reason: "not_found" });
  });
});
