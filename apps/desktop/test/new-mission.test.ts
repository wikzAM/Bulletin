import { describe, expect, it } from "vitest";
import type { Plan, Unit } from "@bulletin/core";
import { GOAL_MAX_LENGTH, GOAL_MIN_LENGTH, planBatches, validateNewMission } from "../src/lib/new-mission";

function unit(id: string, needs: string[] = [], over: Partial<Unit> = {}): Unit {
  return {
    id,
    title: `Unit ${id}`,
    task: "do it",
    files: [`src/${id}.ts`],
    needs: needs.map((n) => ({ unit: n, reads: `${n} output` })),
    lane: "open",
    tier: "station",
    acceptance: [],
    ...over,
  };
}

const plan = (...units: Unit[]): Plan => ({ briefing_version: 1, units });

describe("validateNewMission", () => {
  const goal = "Add due dates to the todo app";

  it("trims and accepts a goal with a local path", () => {
    expect(validateNewMission({ goal: `  ${goal} `, repo: " examples/todo-app " })).toEqual({
      ok: true,
      value: { goal, repo: "examples/todo-app" },
    });
  });

  it("accepts a GitHub URL, with or without .git", () => {
    expect(validateNewMission({ goal, repo: "https://github.com/wikzAM/bulletin" }).ok).toBe(true);
    expect(validateNewMission({ goal, repo: "https://github.com/wikzAM/bulletin.git" }).ok).toBe(true);
  });

  it("requires both fields, reporting each one", () => {
    expect(validateNewMission({ goal: " ", repo: "" })).toEqual({
      ok: false,
      errors: { goal: "Describe the goal in a sentence or two.", repo: "Give a local folder or a GitHub URL." },
    });
  });

  it("rejects a goal that is too short or too long", () => {
    const short = validateNewMission({ goal: "x".repeat(GOAL_MIN_LENGTH - 1), repo: "a" });
    expect(short.ok === false && short.errors.goal).toBeTruthy();
    expect(validateNewMission({ goal: "x".repeat(GOAL_MIN_LENGTH), repo: "a" }).ok).toBe(true);
    const long = validateNewMission({ goal: "x".repeat(GOAL_MAX_LENGTH + 1), repo: "a" });
    expect(long.ok === false && long.errors.goal).toBeTruthy();
  });

  it("rejects web addresses that are not GitHub repositories", () => {
    for (const repo of ["https://gitlab.com/a/b", "http://github.com/a/b", "https://github.com/onlyowner"]) {
      const r = validateNewMission({ goal, repo });
      expect(r.ok === false && r.errors.repo).toBe("Use a GitHub URL like https://github.com/owner/repo, or a local folder.");
    }
  });
});

describe("planBatches", () => {
  it("puts units with no needs in batch 1 and dependents after what they need", () => {
    const batches = planBatches(plan(unit("a"), unit("b"), unit("c", ["a"]), unit("d", ["c", "b"])));
    expect(batches.waves.map((w) => w.map((u) => u.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(batches.unplaced).toEqual([]);
  });

  it("keeps plan order inside a batch", () => {
    const batches = planBatches(plan(unit("z"), unit("a"), unit("m")));
    expect(batches.waves[0]?.map((u) => u.id)).toEqual(["z", "a", "m"]);
  });

  it("leaves units in a cycle or waiting on an unknown unit unplaced instead of looping", () => {
    const batches = planBatches(plan(unit("a"), unit("b", ["c"]), unit("c", ["b"]), unit("d", ["ghost"])));
    expect(batches.waves.map((w) => w.map((u) => u.id))).toEqual([["a"]]);
    expect(batches.unplaced.map((u) => u.id)).toEqual(["b", "c", "d"]);
  });

  it("returns no batches for an empty plan", () => {
    expect(planBatches(plan())).toEqual({ waves: [], unplaced: [] });
  });
});
