import type { Lane } from "@bulletin/core";

export type MergeDecision = "merge" | "hold";

/**
 * What happens to a GREEN unit (spec section 11, lanes table):
 * open merges; gated merges only when green on the first attempt, otherwise it is held
 * for the decision inbox; closed is always held.
 */
export function mergeDecision(lane: Lane, attempt: number): MergeDecision {
  if (lane === "open") return "merge";
  if (lane === "gated") return attempt === 1 ? "merge" : "hold";
  return "hold";
}

/** What happens to a RED unit: "retry" while attempts remain, "fail" once `attempt` reaches `maxAttempts`. */
export function afterRed(attempt: number, maxAttempts: number): "retry" | "fail" {
  return attempt < maxAttempts ? "retry" : "fail";
}

export interface TierOptions {
  /** The attempt number on which a station may move up the ladder. Default 3. */
  escalateOnAttempt?: number;
  /** The tier to move up to. Default "escalated". */
  escalatedTier?: string;
  /** RED reasons that never justify a stronger model. Default ["out of scope", "locked path"]. */
  scopeReasons?: readonly string[];
}

/**
 * The model tier for an attempt (spec section 12): the unit's own tier, except that on the
 * third attempt it moves to the escalated tier, and only if the previous RED reason was not
 * a scope violation. `lastReason` is null on the first attempt.
 *
 * Pinned choices: an attempt beyond escalateOnAttempt stays escalated; scope reasons are
 * matched exactly; a null lastReason does not block escalation.
 */
export function attemptTier(
  unitTier: string,
  attempt: number,
  lastReason: string | null,
  options?: TierOptions,
): string {
  const escalateOnAttempt = options?.escalateOnAttempt ?? 3;
  const escalatedTier = options?.escalatedTier ?? "escalated";
  const scopeReasons = options?.scopeReasons ?? ["out of scope", "locked path"];
  if (attempt >= escalateOnAttempt && (lastReason === null || !scopeReasons.includes(lastReason))) {
    return escalatedTier;
  }
  return unitTier;
}
