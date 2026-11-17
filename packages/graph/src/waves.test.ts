import { PlanSchema } from "@bulletin/core";
import type { Plan, UnitStatus } from "@bulletin/core";
import { describe, expect, it } from "vitest";
import { buildWaves, dependentsOf, readyUnits } from "./waves";

function mk(spec: Record<string, string[]>): Plan {
  return PlanSchema.parse({
    briefing_version: 1,
    units: Object.entries(spec).map(([id, needs]) => ({
      id,
      title: id,
      task: `do ${id}`,
      files: [`${id}/**`],
      needs: needs.map((unit) => ({ unit, reads: "output" })),
    })),
  });
}

const ids = (waves: { id: string }[][]) => waves.map((w) => w.map((u) => u.id));

describe("buildWaves", () => {
  it("puts independent units in one wave in plan order", () => {
    expect(ids(buildWaves(mk({ a: [], b: [], c: [] })))).toEqual([["a", "b", "c"]]);
  });
  it("makes a chain into three waves", () => {
    expect(ids(buildWaves(mk({ a: [], b: ["a"], c: ["b"] })))).toEqual([["a"], ["b"], ["c"]]);
  });
  it("handles a diamond", () => {
    expect(ids(buildWaves(mk({ a: [], b: ["a"], c: ["a"], d: ["b", "c"] })))).toEqual([
      ["a"],
      ["b", "c"],
      ["d"],
    ]);
  });
  it("keeps plan order inside a wave when dependents are listed first", () => {
    expect(ids(buildWaves(mk({ d: ["a"], c: ["a"], b: [], a: [] })))).toEqual([
      ["b", "a"],
      ["d", "c"],
    ]);
  });
  it("throws on a two-unit cycle", () => {
    expect(() => buildWaves(mk({ a: ["b"], b: ["a"] }))).toThrow(/cycle/);
  });
  it("throws on a self-need", () => {
    expect(() => buildWaves(mk({ a: ["a"] }))).toThrow(/cycle/);
  });
  it("throws on an unknown need", () => {
    expect(() => buildWaves(mk({ a: ["ghost"] }))).toThrow(/unknown unit.*ghost/);
  });
});

describe("readyUnits", () => {
  const plan = mk({ a: [], b: ["a"], c: [] });
  const r = (s: Record<string, UnitStatus>) => readyUnits(plan, s).map((u) => u.id);

  it("treats missing statuses as pending", () => {
    expect(r({})).toEqual(["a", "c"]);
  });
  it("does not start a unit whose need is green or held", () => {
    expect(r({ a: "green" })).toEqual(["c"]);
    expect(r({ a: "held" })).toEqual(["c"]);
  });
  it("starts a unit whose needs are merged", () => {
    expect(r({ a: "merged" })).toEqual(["b", "c"]);
  });
  it("excludes running, merged and failed units", () => {
    expect(r({ a: "merged", b: "running", c: "failed" })).toEqual([]);
    expect(r({ a: "merged", b: "merged", c: "merged" })).toEqual([]);
  });
});

describe("dependentsOf", () => {
  const plan = mk({ a: [], b: ["a"], c: ["b"], d: ["b", "c"], e: [] });
  it("returns direct dependents", () => {
    expect(dependentsOf(mk({ a: [], b: ["a"], e: [] }), "a")).toEqual(["b"]);
  });
  it("returns transitive dependents without duplicates in plan order", () => {
    expect(dependentsOf(plan, "a")).toEqual(["b", "c", "d"]);
  });
  it("handles a diamond without duplicates", () => {
    expect(dependentsOf(mk({ d: ["b", "c"], c: ["a"], b: ["a"], a: [] }), "a")).toEqual([
      "d",
      "c",
      "b",
    ]);
  });
  it("never includes the unit itself", () => {
    expect(dependentsOf(mk({ a: ["a"] }), "a")).toEqual([]);
    expect(dependentsOf(plan, "b")).not.toContain("b");
  });
  it("gives [] for a leaf", () => {
    expect(dependentsOf(plan, "d")).toEqual([]);
    expect(dependentsOf(plan, "e")).toEqual([]);
  });
});
