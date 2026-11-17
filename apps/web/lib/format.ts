/** Amounts under a dollar read better in cents; ledger rows are often fractions of a cent. */
export function formatCents(cents: number): string {
  const value = Number.isFinite(cents) ? cents : 0;
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) >= 100) return `$${(Math.round(value) / 100).toFixed(2)}`;
  return `${rounded === 0 ? 0 : rounded}¢`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
