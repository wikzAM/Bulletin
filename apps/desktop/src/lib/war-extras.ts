import type { WarTableState } from "./war-table";

export type Courier = {
  unitId: string;
  direction: "to-hq" | "from-hq";
  questionId: string | null;
};

export type MissionReceipt = {
  shipped: number;
  held: number;
  failed: number;
  blocked: number;
  touches: number;
  spent_cents: number;
  ending: NonNullable<WarTableState["ending"]>;
};

/** True when the OS asks for less motion (or when no window is available, treat as false). */
export function prefersReducedMotion(win: { matchMedia?: (q: string) => { matches: boolean } } = globalThis as { matchMedia?: (q: string) => { matches: boolean } }): boolean {
  return Boolean(win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

/**
 * Couriers still in flight: asked without a later answered for the same unit+question.
 * Spec: animate on dispatch.asked / dispatch.answered between the task and HQ.
 */
export function activeCouriers(state: WarTableState): Courier[] {
  const open = new Map<string, Courier>();
  for (const item of state.feed) {
    const unitId = item.unit_id;
    if (!unitId) continue;
    const q = typeof item.payload.question_id === "string" ? item.payload.question_id : null;
    const key = `${unitId}:${q ?? ""}`;
    if (item.type === "dispatch.asked") {
      open.set(key, { unitId, direction: "to-hq", questionId: q });
    } else if (item.type === "dispatch.answered") {
      open.delete(key);
    }
  }
  return [...open.values()];
}

/** Receipt card after mission.finished: counts from the payload, spend from ledger. */
export function missionReceipt(state: WarTableState): MissionReceipt | null {
  if (!state.ending) return null;
  const finished = [...state.feed].reverse().find((e) => e.type === "mission.finished");
  if (!finished) return null;
  const p = finished.payload;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const spent = Object.values(state.units).reduce((sum, u) => sum + u.spent_cents, 0);
  return {
    shipped: num(p.shipped),
    held: num(p.held),
    failed: num(p.failed),
    blocked: num(p.blocked),
    touches: num(p.touches),
    spent_cents: spent,
    ending: state.ending,
  };
}
