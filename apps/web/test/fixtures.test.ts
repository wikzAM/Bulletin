import { describe, expect, it } from "vitest";
import { copy } from "../lib/copy";
import { DEMO_SCENARIOS, demoScenario, demoState } from "../lib/fixtures";
import { summarizeTreasury } from "../lib/treasury";
import { describeEvent, groupWaves, reduceEvents, unitTitles, type UnitCard } from "../lib/war-table";

const byId = (id: string) => {
  const s = demoScenario(id);
  if (!s) throw new Error(`missing scenario ${id}`);
  return { scenario: s, state: demoState(s) };
};

const cards = (state: ReturnType<typeof demoState>): UnitCard[] => state.order.flatMap((id) => (state.units[id] ? [state.units[id]] : []));

describe("demo scenarios", () => {
  it("cover running, held, sent back, over budget, paused, stopped and interrupted", () => {
    expect(DEMO_SCENARIOS.map((s) => s.id)).toEqual(["running", "held", "sent-back", "over-budget", "paused", "stopped", "interrupted"]);
    for (const s of DEMO_SCENARIOS) {
      expect(copy.demo.scenarios[s.id].title).toBeTruthy();
      expect(copy.demo.scenarios[s.id].summary).toBeTruthy();
    }
  });

  it("running: work is in progress and some is already done", () => {
    const statuses = cards(byId("running").state).map((u) => u.status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("merged");
    expect(statuses).toContain("pending");
  });

  it("held: a finished task waits for approval", () => {
    const { state } = byId("held");
    const held = cards(state).filter((u) => u.status === "held");
    expect(held).toHaveLength(1);
    expect(held[0]?.history.at(-1)?.result).toBe("green");
  });

  it("sent back: the rejected try keeps its evidence and packet, and a new try is running", () => {
    const { state } = byId("sent-back");
    const unit = cards(state).find((u) => u.history.some((a) => a.sent_back));
    expect(unit).toBeDefined();
    expect(unit?.status).toBe("running");
    expect(unit?.attempts).toBe(2);
    const rejected = unit?.history[0];
    expect(rejected).toMatchObject({ result: "red", sent_back: true });
    expect(rejected?.evidence).toBeTruthy();
    expect(rejected?.packet).toBeTruthy();
    expect(unit?.last_reason).toBeTruthy();
  });

  it("over budget: spend is past the budget", () => {
    const { scenario, state } = byId("over-budget");
    const summary = summarizeTreasury(state, scenario.treasury);
    expect(summary.level).toBe("over");
    expect(summary.spent_cents).toBeGreaterThan(summary.budget_cents ?? Infinity);
    expect(summary.remaining_cents).toBe(0);
    expect(state.paused).toBe(false);
  });

  it("paused: spending stopped close to the budget and nothing is running", () => {
    const { scenario, state } = byId("paused");
    const summary = summarizeTreasury(state, scenario.treasury);
    expect(state.paused).toBe(true);
    expect(summary.paused).toBe(true);
    expect(summary.level).toBe("warning");
    expect(cards(state).some((u) => u.status === "running")).toBe(false);
  });

  it("every fixture event reads as a plain sentence", () => {
    for (const s of DEMO_SCENARIOS) {
      const state = demoState(s);
      const titles = unitTitles(state);
      for (const e of s.events) {
        const text = describeEvent(e, titles);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/undefined|null|\[object/);
      }
      expect(state.lastEventId).toBe(s.events.length);
    }
  });

  it("is unknown for other ids", () => {
    expect(demoScenario("nope")).toBeUndefined();
  });
});

describe("groupWaves", () => {
  it("groups cards by batch in order, keeping plan order inside a batch", () => {
    const { state } = byId("running");
    const waves = groupWaves(state);
    expect(waves.map(([w]) => w)).toEqual([...waves.map(([w]) => w)].sort((a, b) => a - b));
    expect(waves.flatMap(([, list]) => list.map((u) => u.id))).toHaveLength(state.order.length);
    for (const [wave, list] of waves) for (const u of list) expect(u.wave).toBe(wave);
  });

  it("is empty before there is a plan, so the board shows its empty message", () => {
    expect(groupWaves(reduceEvents([], []))).toEqual([]);
  });
});
