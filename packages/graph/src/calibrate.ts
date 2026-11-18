/*
 * Fare calibration (spec section 12). The fare estimate shown before approval is built from token estimates
 * priced at each tier's model. After a mission, comparing what each tier actually cost with what it was
 * estimated to cost gives a factor per tier; scaling the next estimate by it makes the fare honest over time.
 */

/** A factor outside this range means the estimate was nonsense or the mission was unusual, not that prices moved. */
export const CALIBRATION_MIN = 0.25;
export const CALIBRATION_MAX = 4;

export interface EstimateSample {
  unitId: string;
  tier: string;
  /** Estimated cents for the unit (the Fare's perUnit value, before overhead). */
  cents: number;
}

export interface ActualSample {
  unitId: string;
  /** Cents charged to the unit: one ledger row. Several rows for one unit (retries, send-backs) are added up. */
  cents: number;
}

export type Calibration = Record<string, number>;

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/**
 * Ratio of actual to estimated cost per tier. A tier appears only when it has a positive estimate and at
 * least one actual charge to compare with; spend on units that had no estimate is ignored. The ratio is
 * clamped to [CALIBRATION_MIN, CALIBRATION_MAX] and rounded to 4 decimals.
 */
export function calibrate(estimates: readonly EstimateSample[], actuals: readonly ActualSample[]): Calibration {
  const actualByUnit = new Map<string, number>();
  for (const a of actuals) actualByUnit.set(a.unitId, (actualByUnit.get(a.unitId) ?? 0) + a.cents);

  const totals = new Map<string, { estimated: number; actual: number }>();
  for (const e of estimates) {
    const actual = actualByUnit.get(e.unitId);
    if (actual === undefined) continue; // the unit never ran: nothing to learn
    const total = totals.get(e.tier) ?? { estimated: 0, actual: 0 };
    total.estimated += e.cents;
    total.actual += actual;
    totals.set(e.tier, total);
  }

  const factors: Calibration = {};
  for (const [tier, { estimated, actual }] of totals) {
    if (estimated <= 0) continue;
    factors[tier] = round4(Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, actual / estimated)));
  }
  return factors;
}

/** Scale per-unit estimates (a Fare's perUnit) by their tier's factor. Tiers without a factor are unchanged. */
export function applyCalibration(
  perUnit: Readonly<Record<string, number>>,
  tierOf: Readonly<Record<string, string>>,
  factors: Readonly<Calibration>,
): Record<string, number> {
  const scaled: Record<string, number> = {};
  for (const [unitId, cents] of Object.entries(perUnit)) {
    const tier = tierOf[unitId];
    const factor = tier !== undefined && Object.hasOwn(factors, tier) ? factors[tier] : undefined;
    scaled[unitId] = factor === undefined ? cents : round4(cents * factor);
  }
  return scaled;
}
