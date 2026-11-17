import { DEFAULT_LIMITS } from "@bulletin/core";
import type { PricesConfig, TokenEstimate, Usage } from "@bulletin/core";

// Choices left open by the spec:
// - Math.ceil is guarded by rounding to 6 decimals first, so float noise cannot add a cent.
// - perUnit values are the costCents results (4 decimals), not rounded to whole cents.
// - shortfallCents is 0 when ok.

const ceilCents = (x: number): number => Math.ceil(Math.round(x * 1e6) / 1e6);

/**
 * Cost of one model call in cents, from token counts and config/prices.json
 * (dollars per million tokens). `input_tokens` is uncached input only; cache reads and
 * cache writes are priced separately. Rounded to 4 decimal places to match ledger.cost_cents.
 * Throws an Error naming the model if it has no price.
 */
export function costCents(model: string, usage: Usage, prices: PricesConfig): number {
  const price = Object.hasOwn(prices.models, model) ? prices.models[model] : undefined;
  if (!price) throw new Error(`no price for model: ${model}`);
  const cents =
    (100 *
      (usage.input_tokens * price.input +
        usage.output_tokens * price.output +
        usage.cache_read_tokens * price.cache_read +
        usage.cache_write_tokens * price.cache_write)) /
    1_000_000;
  return Math.round(cents * 1e4) / 1e4;
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
  units: readonly FareUnit[],
  tiers: Readonly<Record<string, string>>,
  prices: PricesConfig,
  options: FareOptions = {},
): Fare {
  const overhead = options.overhead ?? DEFAULT_LIMITS.fareOverhead;
  const highMultiplier = options.highMultiplier ?? DEFAULT_LIMITS.fareHighMultiplier;
  const defaultEstimate = options.defaultEstimate ?? { input_tokens: 200000, output_tokens: 30000 };
  const perUnit: Record<string, number> = {};
  let sum = 0;
  for (const unit of units) {
    const model = Object.hasOwn(tiers, unit.tier) ? tiers[unit.tier] : undefined;
    if (!model) throw new Error(`no model for tier: ${unit.tier}`);
    const est = unit.estimate ?? defaultEstimate;
    const cents = costCents(
      model,
      {
        input_tokens: est.input_tokens,
        output_tokens: est.output_tokens,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
      prices,
    );
    perUnit[unit.id] = cents;
    sum += cents;
  }
  const lowCents = ceilCents(sum * (1 + overhead));
  const highCents = ceilCents(lowCents * highMultiplier);
  return { perUnit, lowCents, highCents };
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
export function capCheck(input: CapInput): { ok: boolean; shortfallCents: number } {
  const total = input.spentCents + input.reservedCents + input.nextEstimateCents;
  const ok = total <= input.budgetCents;
  return { ok, shortfallCents: ok ? 0 : total - input.budgetCents };
}

/**
 * Share of input tokens served from cache: cache_read / (input + cache_read + cache_write),
 * over all the usages given. 0 when there are no input tokens. Tracked per role (spec section 12).
 */
export function cacheReadShare(usages: readonly Usage[]): number {
  let read = 0;
  let denom = 0;
  for (const u of usages) {
    read += u.cache_read_tokens;
    denom += u.input_tokens + u.cache_read_tokens + u.cache_write_tokens;
  }
  return denom === 0 ? 0 : read / denom;
}
