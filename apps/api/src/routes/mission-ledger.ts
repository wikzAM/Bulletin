import type { BulletinEvent } from "@bulletin/core";

export const DEFAULT_MISSION_BUDGET_CENTS = 500;
export const DEFAULT_UNIT_ALLOWANCE_CENTS = 200;

export function readMissionBudget(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function readLedgerCharge(event: BulletinEvent): number | undefined {
  const cost = event.payload.cost_cents;
  return event.type === "ledger.charged" && typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

export function roundCents(cents: number): number {
  return Math.round(cents * 1e4) / 1e4;
}
