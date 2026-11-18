import { DEFAULT_LIMITS } from "@bulletin/core";

/**
 * The fare shown before a plan is approved (spec section 12) is a range: the estimate, and a high end that
 * covers retries. The multiplier defaults to the spec's 1.8.
 */
export function fareRange(
  lowCents: number,
  highMultiplier: number = DEFAULT_LIMITS.fareHighMultiplier,
): { lowCents: number; highCents: number } {
  if (!Number.isFinite(lowCents) || lowCents < 0) throw new Error("the low estimate must be a number of cents, zero or more");
  const ceil = (x: number) => Math.ceil(Math.round(x * 1e6) / 1e6);
  return { lowCents, highCents: Math.max(lowCents, ceil(lowCents * highMultiplier)) };
}
