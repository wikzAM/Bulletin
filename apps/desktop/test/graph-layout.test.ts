import { describe, expect, it } from "vitest";
import { describeNeeds, GRAPH, layoutGraph, type GraphNode } from "../src/lib/graph-layout";
import type { PlannedUnit } from "../src/lib/types";

const units: PlannedUnit[] = [
  { id: "store", title: "Store", lane: "gated", wave: 1, needs: [] },
  { id: "helpers", title: "Helpers", lane: "open", wave: 1, needs: [] },
  { id: "list", title: "List view", lane: "open", wave: 2, needs: ["store", "helpers"] },
  { id: "filter", title: "Filter", lane: "open", wave: 2, needs: ["store"] },
  { id: "e2e", title: "End-to-end tests", lane: "open", wave: 3, needs: ["list", "filter", "ghost"] },
];

function overlaps(a: GraphNode, b: GraphNode): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("layoutGraph", () => {
  it("puts each batch in its own column, left to right", () => {
    const { nodes } = layoutGraph(units);
    const x = (id: string) => nodes.find((n) => n.id === id)?.x;
    expect(x("store")).toBe(x("helpers"));
    expect(x("list")).toBe(x("filter"));
    expect(x("store")!).toBeLessThan(x("list")!);
    expect(x("list")!).toBeLessThan(x("e2e")!);
  });

  it("keeps plan order top to bottom inside a column", () => {
    const { nodes } = layoutGraph(units);
    const y = (id: string) => nodes.find((n) => n.id === id)?.y ?? NaN;
    expect(y("store")).toBeLessThan(y("helpers"));
    expect(y("list")).toBeLessThan(y("filter"));
  });

  it("never overlaps two nodes", () => {
    const many: PlannedUnit[] = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, title: `Task ${i}`, lane: "open", wave: (i % 3) + 1, needs: [] }));
    const { nodes } = layoutGraph(many);
    for (const a of nodes) for (const b of nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it("fits every node inside the drawing", () => {
    const { nodes, width, height } = layoutGraph(units);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(width);
      expect(n.y + n.height).toBeLessThanOrEqual(height);
    }
  });

  it("draws one edge per known need, from the right side of the need to the left side of the task", () => {
    const { nodes, edges } = layoutGraph(units);
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual(["store->list", "helpers->list", "store->filter", "list->e2e", "filter->e2e"]);
    const store = nodes.find((n) => n.id === "store")!;
    const list = nodes.find((n) => n.id === "list")!;
    const edge = edges[0]!;
    expect([edge.x1, edge.y1]).toEqual([store.x + store.width, store.y + store.height / 2]);
    expect([edge.x2, edge.y2]).toEqual([list.x, list.y + list.height / 2]);
  });

  it("puts tasks outside the plan (batch 0) in a last column", () => {
    const { nodes } = layoutGraph([...units, { id: "stray", title: "Stray", lane: "open", wave: 0, needs: [] }]);
    const stray = nodes.find((n) => n.id === "stray")!;
    expect(Math.max(...nodes.map((n) => n.x))).toBe(stray.x);
  });

  it("shortens long titles so they fit the node", () => {
    const { nodes } = layoutGraph([{ id: "a", title: "x".repeat(80), lane: "open", wave: 1, needs: [] }]);
    expect(nodes[0]?.label.length).toBeLessThanOrEqual(GRAPH.maxLabel);
    expect(nodes[0]?.label.endsWith("…")).toBe(true);
  });

  it("is empty with no tasks", () => {
    expect(layoutGraph([])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });
});

describe("describeNeeds", () => {
  it("says in words what each task waits for, skipping unknown needs", () => {
    expect(describeNeeds(units)).toEqual([
      "List view waits for Store and Helpers.",
      "Filter waits for Store.",
      "End-to-end tests waits for List view and Filter.",
    ]);
  });

  it("joins three or more with commas", () => {
    const three: PlannedUnit[] = [
      ...["a", "b", "c"].map((id) => ({ id, title: id.toUpperCase(), lane: "open" as const, wave: 1, needs: [] })),
      { id: "d", title: "D", lane: "open", wave: 2, needs: ["a", "b", "c"] },
    ];
    expect(describeNeeds(three)).toEqual(["D waits for A, B and C."]);
  });
});
