import { describe, expect, it } from "vitest";
import { toFlowGraph } from "../src/lib/flow-layout";
import type { PlannedUnit } from "../src/lib/types";
import { reduceEvents } from "../src/lib/war-table";
import type { BulletinEvent, EventType } from "@bulletin/core";

const units: PlannedUnit[] = [
  { id: "store", title: "Store", lane: "open", wave: 1, needs: [] },
  { id: "list", title: "List view", lane: "open", wave: 2, needs: ["store"] },
];

let nextId = 1;
function ev(type: EventType, unitId: string | null, payload: Record<string, unknown> = {}): BulletinEvent {
  return { id: nextId++, mission_id: "m1", ts: "2026-11-18T12:00:00.000Z", type, unit_id: unitId, payload };
}

describe("toFlowGraph", () => {
  it("places one node per unit in wave columns and edges for needs", () => {
    const { nodes, edges } = toFlowGraph(units);
    expect(nodes.map((n) => n.id)).toEqual(["store", "list"]);
    expect(nodes[0]!.position.x).toBeLessThan(nodes[1]!.position.x);
    expect(edges).toEqual([expect.objectContaining({ id: "store->list", source: "store", target: "list" })]);
  });

  it("marks not-started units with fog and lifts fog when the unit has started", () => {
    const pending = toFlowGraph(units);
    expect(pending.nodes.every((n) => n.data.fog)).toBe(true);

    const state = reduceEvents(units, [ev("plan.approved", null), ev("unit.started", "store"), ev("attempt.started", "store", { attempt: 1 })]);
    const live = toFlowGraph(units, state.units);
    expect(live.nodes.find((n) => n.id === "store")?.data.fog).toBe(false);
    expect(live.nodes.find((n) => n.id === "list")?.data.fog).toBe(true);
    expect(live.nodes.find((n) => n.id === "store")?.data.status).toBe("running");
  });
});
