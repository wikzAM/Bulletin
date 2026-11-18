import type { PricesConfig, TokenEstimate } from "@bulletin/core";
import { costCents } from "../treasury/treasury";

/*
 * The treasury preflight (spec section 12): before an attempt starts, spent + reserved + the attempt's own
 * estimate must fit the mission budget. These are the engine's pieces for it; the arithmetic of the cap itself
 * is `capCheck` in treasury.ts.
 */

/**
 * What one attempt of a unit is expected to cost, in cents: the plan's token estimate priced at the model the
 * attempt will use, scaled by the tier's calibration factor (from `calibrate`, after earlier missions).
 * A unit with no estimate returns 0: the preflight then adds nothing, and the hard cap still applies as spend arrives.
 */
export function attemptEstimateCents(
  unit: { tier: string; estimate?: TokenEstimate },
  model: string,
  prices: PricesConfig,
  calibration: Readonly<Record<string, number>> = {},
): number {
  if (!unit.estimate) return 0;
  const base = costCents(
    model,
    { input_tokens: unit.estimate.input_tokens, output_tokens: unit.estimate.output_tokens, cache_read_tokens: 0, cache_write_tokens: 0 },
    prices,
  );
  const raw = Object.hasOwn(calibration, unit.tier) ? calibration[unit.tier]! : 1;
  const factor = Number.isFinite(raw) && raw > 0 ? raw : 1; // a zero, negative or NaN factor is noise, not a discount
  return base * factor;
}

/**
 * Allowance promised to attempts that are still running. An attempt reserves its estimate, and what it has
 * already been charged comes off, because that money is in `spent` now; counting both would pause too early.
 */
export class Reservations {
  private readonly open = new Map<string, { estimate: number; charged: number }>();

  reserve(key: string, estimateCents: number): void {
    this.open.set(key, { estimate: estimateCents, charged: 0 });
  }

  charge(key: string, cents: number): void {
    const entry = this.open.get(key);
    if (entry) entry.charged += cents;
  }

  release(key: string): void {
    this.open.delete(key);
  }

  total(): number {
    let sum = 0;
    for (const { estimate, charged } of this.open.values()) sum += Math.max(0, estimate - charged);
    return sum;
  }
}
