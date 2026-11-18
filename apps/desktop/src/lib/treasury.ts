import type { TreasuryInfo } from "./types";
import type { WarTableState } from "./war-table";

/** Spend above this share of the budget shows a warning. */
export const WARNING_RATIO = 0.8;

export type BudgetLevel = "ok" | "warning" | "over" | "unknown";

export function budgetLevel(spent: number, budget: number | null): BudgetLevel {
  if (budget === null || budget <= 0) return "unknown";
  return spent > budget ? "over" : spent / budget > WARNING_RATIO ? "warning" : "ok";
}

export interface TreasurySummary {
  spent_cents: number;
  budget_cents: number | null;
  remaining_cents: number | null;
  ratio: number | null;
  level: BudgetLevel;
  paused: boolean;
  units: { id: string; title: string; spent_cents: number }[];
}

/** Spend comes from the event log (ledger.charged); only the budget comes from the treasury route. */
export function summarizeTreasury(state: WarTableState, info: TreasuryInfo | null): TreasurySummary {
  const units = state.order
    .flatMap((id) => {
      const u = state.units[id];
      return u && u.spent_cents > 0 ? [{ id: u.id, title: u.title, spent_cents: u.spent_cents }] : [];
    })
    .sort((a, b) => b.spent_cents - a.spent_cents);
  const spent = units.reduce((sum, u) => sum + u.spent_cents, 0);
  const budget = info && info.budget_cents > 0 ? info.budget_cents : null;

  if (budget === null) {
    return { spent_cents: spent, budget_cents: null, remaining_cents: null, ratio: null, level: "unknown", paused: state.paused, units };
  }

  const ratio = spent / budget;
  const level = budgetLevel(spent, budget);
  return {
    spent_cents: spent,
    budget_cents: budget,
    remaining_cents: Math.max(0, budget - spent),
    ratio,
    level,
    paused: state.paused,
    units,
  };
}
