import { copy } from "./copy";
import { formatCents } from "./format";
import type { ApproveResult, MissionStatus } from "./types";
import type { WarTableState } from "./war-table";

export interface ApproveMessage {
  tone: "ok" | "error";
  text: string;
}

export function approveMessage(result: ApproveResult): ApproveMessage {
  const t = copy.approve;
  if (result.ok) return { tone: "ok", text: t.ok };
  switch (result.reason) {
    case "over_budget":
      return {
        tone: "error",
        text: t.overBudget(
          formatCents(result.estimated_cents),
          formatCents(result.budget_cents),
          result.spent_cents > 0 ? formatCents(result.spent_cents) : null,
          formatCents(result.shortfall_cents),
        ),
      };
    case "already":
      return { tone: "ok", text: t.already };
    case "no_plan":
      return { tone: "error", text: t.noPlan };
    case "unpriced":
      return { tone: "error", text: t.unpriced };
    case "not_configured":
      return { tone: "error", text: t.notConfigured };
    case "not_found":
      return { tone: "error", text: t.notFound };
  }
}

/** A plan can be approved while the project is in planning, has tasks, and the stream has not shown approval or the end. */
export function canApprove(status: MissionStatus, state: WarTableState): boolean {
  return status === "planning" && state.order.length > 0 && !state.approved && !state.finished;
}
