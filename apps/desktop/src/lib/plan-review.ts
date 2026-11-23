import { copy } from "./copy";
import type { ReviseResult } from "./types";

/** Spec fare range: estimate low, 1.8× high for retries. */
export const FARE_HIGH_MULTIPLE = 1.8;

export interface FareRange {
  low_cents: number;
  high_cents: number;
}

export function fareRangeCents(estimateCents: number, highMultiple = FARE_HIGH_MULTIPLE): FareRange {
  const low = Math.max(0, Math.round(estimateCents));
  return { low_cents: low, high_cents: Math.round(low * highMultiple) };
}

export function formatFareRange(range: FareRange, formatCents: (n: number) => string): string {
  return `About ${formatCents(range.low_cents)} to ${formatCents(range.high_cents)}`;
}

/** Comments trigger one revision only (spec F2). */
export function canRequestRevision(revisionsUsed: number, max = 1): boolean {
  return revisionsUsed < max;
}

export function nextRevisionCount(revisionsUsed: number, max = 1): number {
  return Math.min(revisionsUsed + 1, max);
}

export interface ReviseMessage {
  tone: "ok" | "error";
  text: string;
}

/** What to tell the person after a revision request. A refusal that spends the one revision (`already`) counts as used. */
export function reviseMessage(result: ReviseResult): ReviseMessage {
  const t = copy.planReview.revision;
  if (result.ok) return { tone: "ok", text: t.ok };
  switch (result.reason) {
    case "already":
      return { tone: "error", text: t.already };
    case "no_plan":
      return { tone: "error", text: t.noPlan };
    case "closed":
      return { tone: "error", text: t.closed };
    case "busy":
      return { tone: "error", text: t.busy };
    case "not_found":
      return { tone: "error", text: t.notFound };
    case "invalid":
      return { tone: "error", text: t.invalid };
    case "planning_failed":
      return { tone: "error", text: t.planningFailed };
  }
}

/** The one revision is spent when it worked, or the server says it was already made. A failed try leaves it available. */
export function revisionSpent(result: ReviseResult): boolean {
  return result.ok || result.reason === "already";
}
