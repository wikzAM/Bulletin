import { copy } from "./copy";
import type { ResolveResult } from "./types";
import type { DecisionChoice, WarTableState } from "./war-table";

export interface HeldItem {
  id: string;
  title: string;
  why: string;
  branch: string | null;
  /** The choice from the log, or the one just made on this page; null while waiting. */
  choice: DecisionChoice | null;
}

/** Held tasks in plan order. `local` holds choices made on this page before the stream catches up. */
export function heldForYou(state: WarTableState, local: Record<string, DecisionChoice>): HeldItem[] {
  const t = copy.held;
  return state.order.flatMap((id) => {
    const unit = state.units[id];
    if (!unit || (unit.status !== "held" && !unit.decision)) return [];
    const kind = unit.decision?.kind ?? (unit.lane === "closed" ? "closed_lane_merge" : "gated_retry");
    return [{ id, title: unit.title, why: t.why[kind], branch: unit.decision?.branch ?? null, choice: unit.decision?.choice ?? local[id] ?? null }];
  });
}

export function resolveMessage(choice: DecisionChoice, result: ResolveResult): { tone: "ok" | "error"; text: string } {
  const t = copy.held;
  if (result.ok) return { tone: "ok", text: choice === "approve" ? t.approved : t.rejected };
  switch (result.reason) {
    case "already":
      return { tone: "ok", text: t.already };
    case "busy":
      return { tone: "error", text: t.busy };
    case "not_found":
      return { tone: "error", text: t.notFound };
    case "unavailable":
      return { tone: "error", text: t.unavailable };
  }
}
