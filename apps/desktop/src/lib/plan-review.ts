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
