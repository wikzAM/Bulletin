import { describe, expect, it } from "vitest";
import { toSpendInfo } from "../lib/api-adapters";
import { mockSpend, mockSummaries } from "../lib/mock";
import { budgetLevel, summarizeSpend, type ProjectSpend } from "../lib/spend";

function project(id: string, spent: number, budget: number | null): ProjectSpend {
  return { id, goal: `Goal ${id}`, status: "running", spent_cents: spent, budget_cents: budget };
}

describe("budgetLevel", () => {
  it("warns above 80 percent and is over past the budget", () => {
    expect(budgetLevel(80, 100)).toBe("ok");
    expect(budgetLevel(81, 100)).toBe("warning");
    expect(budgetLevel(100, 100)).toBe("warning");
    expect(budgetLevel(101, 100)).toBe("over");
    expect(budgetLevel(5, null)).toBe("unknown");
    expect(budgetLevel(5, 0)).toBe("unknown");
  });
});

describe("summarizeSpend", () => {
  it("totals spend across projects and counts the ones near or over budget", () => {
    const s = summarizeSpend([project("a", 10, 100), project("b", 90, 100), project("c", 120, 100), project("d", 7, null)]);
    expect(s.total_spent_cents).toBe(227);
    expect(s.total_budget_cents).toBe(300);
    expect(s.unbudgeted).toBe(1);
    expect(s.needs_attention).toBe(2);
  });

  it("puts over-budget projects first, then warnings, then the rest by spend", () => {
    const s = summarizeSpend([project("a", 10, 100), project("b", 90, 100), project("c", 120, 100), project("d", 50, null), project("e", 30, 100)]);
    expect(s.rows.map((r) => [r.id, r.level])).toEqual([
      ["c", "over"],
      ["b", "warning"],
      ["d", "unknown"],
      ["e", "ok"],
      ["a", "ok"],
    ]);
  });

  it("gives each row its share of the budget and what is left, never below zero", () => {
    const [over, ok] = summarizeSpend([project("c", 120, 100), project("a", 25, 100)]).rows;
    expect(over).toMatchObject({ ratio: 1.2, remaining_cents: 0 });
    expect(ok).toMatchObject({ ratio: 0.25, remaining_cents: 75 });
  });

  it("is all zeros with no projects", () => {
    expect(summarizeSpend([])).toEqual({ rows: [], total_spent_cents: 0, total_budget_cents: 0, unbudgeted: 0, needs_attention: 0 });
  });
});

describe("toSpendInfo", () => {
  it("reads cost and budget from the treasury route", () => {
    expect(toSpendInfo({ mission_id: "m", budget_cents: 500, cost_cents: 1.25, remaining_cents: 498.75 })).toEqual({ spent_cents: 1.25, budget_cents: 500 });
  });

  it("keeps spend when the log has no budget", () => {
    expect(toSpendInfo({ budget_cents: null, cost_cents: 3 })).toEqual({ spent_cents: 3, budget_cents: null });
  });

  it("is null for a body it cannot read", () => {
    expect(toSpendInfo(null)).toBeNull();
    expect(toSpendInfo({ error: "Mission not found" })).toBeNull();
  });
});

describe("mock spend", () => {
  it("sums each mock project's charges and pairs them with its budget", () => {
    const ids = mockSummaries().map((m) => m.id);
    const spend = ids.map((id) => mockSpend(id));
    expect(spend.every((s) => s !== null)).toBe(true);
    expect(spend.some((s) => (s?.spent_cents ?? 0) > 0)).toBe(true);
    expect(mockSpend("missing")).toBeNull();
  });
});
