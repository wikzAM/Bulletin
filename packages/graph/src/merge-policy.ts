import type { Lane } from "@bulletin/core";

export type MergeDecision = "merge" | "hold";

/**
 * What happens to a GREEN unit (spec section 11, lanes table):
 * open merges; gated merges only when green on the first attempt, otherwise it is held
 * for the decision inbox; closed is always held.
 *
 * Stub: implemented by a graph unit.
 */
export function mergeDecision(_lane: Lane, _attempt: number): MergeDecision {
  throw new Error("not implemented: mergeDecision");
}

/** What happens to a RED unit: "retry" while attempts remain, "fail" once `attempt` reaches `maxAttempts`. */
export function afterRed(_attempt: number, _maxAttempts: number): "retry" | "fail" {
  throw new Error("not implemented: afterRed");
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
 */
export function attemptTier(
  _unitTier: string,
  _attempt: number,
  _lastReason: string | null,
  _options?: TierOptions,
): string {
  throw new Error("not implemented: attemptTier");
}
