import type { PricesConfig, TokenEstimate, Usage } from "@bulletin/core";

/**
 * Cost of one model call in cents, from token counts and config/prices.json
 * (dollars per million tokens). `input_tokens` is uncached input only; cache reads and
 * cache writes are priced separately. Rounded to 4 decimal places to match ledger.cost_cents.
 * Throws an Error naming the model if it has no price.
 *
 * Stub: implemented by a graph unit.
 */
export function costCents(_model: string, _usage: Usage, _prices: PricesConfig): number {
  throw new Error("not implemented: costCents");
}

export interface FareUnit {
  id: string;
  tier: string;
  estimate?: TokenEstimate;
}

export interface FareOptions {
  /** Share added for the General and answerer. Default DEFAULT_LIMITS.fareOverhead (0.15). */
  overhead?: number;
  /** High end of the range as a multiple of the low end, covering retries. Default 1.8. */
  highMultiplier?: number;
  /** Estimate used for a unit that has none. Default { input_tokens: 200000, output_tokens: 30000 }. */
  defaultEstimate?: TokenEstimate;
}

export interface Fare {
  /** Estimated cents per unit id, before overhead. */
  perUnit: Record<string, number>;
  /** Sum of perUnit plus overhead, rounded up to a whole cent. */
  lowCents: number;
  /** lowCents times highMultiplier, rounded up to a whole cent. */
  highCents: number;
}

/**
 * The fare estimate shown before a plan is approved (spec section 12): each unit's token
 * estimate priced at its tier's model, plus overhead, as a low-high range.
 * `tiers` maps a tier name to a model id (config/models.json "tiers").
 * Throws an Error naming the tier if it has no model.
 */
export function fareEstimate(
  _units: readonly FareUnit[],
  _tiers: Readonly<Record<string, string>>,
  _prices: PricesConfig,
  _options?: FareOptions,
): Fare {
  throw new Error("not implemented: fareEstimate");
}

export interface CapInput {
  budgetCents: number;
  spentCents: number;
  /** Allowance already promised to attempts that are still running. */
  reservedCents: number;
  nextEstimateCents: number;
}

/**
 * The hard cap, checked before any attempt or model call: spent + reserved + next must fit
 * the budget. When it does not, the mission pauses and a budget_increase decision opens.
 * `shortfallCents` is 0 when ok, otherwise how far over the budget the next step would go.
 */
export function capCheck(_input: CapInput): { ok: boolean; shortfallCents: number } {
  throw new Error("not implemented: capCheck");
}

/**
 * Share of input tokens served from cache: cache_read / (input + cache_read + cache_write),
 * over all the usages given. 0 when there are no input tokens. Tracked per role (spec section 12).
 */
export function cacheReadShare(_usages: readonly Usage[]): number {
  throw new Error("not implemented: cacheReadShare");
}
