import { budgetLevel, type BudgetLevel } from "./treasury";
import type { MissionStatus } from "./types";

export { budgetLevel };

export interface ProjectSpend {
  id: string;
  goal: string;
  status: MissionStatus;
  spent_cents: number;
  budget_cents: number | null;
}

export interface SpendRow extends ProjectSpend {
  ratio: number | null;
  remaining_cents: number | null;
  level: BudgetLevel;
}

export interface SpendOverview {
  rows: SpendRow[];
  total_spent_cents: number;
  /** Sum of the budgets that are set; projects without one are counted in `unbudgeted`. */
  total_budget_cents: number;
  unbudgeted: number;
  /** Projects past the warning share of their budget, or over it. */
  needs_attention: number;
}

const LEVEL_ORDER: Record<BudgetLevel, number> = { over: 0, warning: 1, unknown: 2, ok: 2 };

export function summarizeSpend(projects: ProjectSpend[]): SpendOverview {
  const rows: SpendRow[] = projects.map((p) => {
    const level = budgetLevel(p.spent_cents, p.budget_cents);
    const budget = level === "unknown" ? null : p.budget_cents;
    return {
      ...p,
      level,
      ratio: budget === null ? null : p.spent_cents / budget,
      remaining_cents: budget === null ? null : Math.max(0, budget - p.spent_cents),
    };
  });
  rows.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.spent_cents - a.spent_cents);
  return {
    rows,
    total_spent_cents: rows.reduce((sum, r) => sum + r.spent_cents, 0),
    total_budget_cents: rows.reduce((sum, r) => sum + (r.level === "unknown" ? 0 : (r.budget_cents ?? 0)), 0),
    unbudgeted: rows.filter((r) => r.level === "unknown").length,
    needs_attention: rows.filter((r) => r.level === "over" || r.level === "warning").length,
  };
}
