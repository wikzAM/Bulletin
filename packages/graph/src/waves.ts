import type { Plan, Unit, UnitStatus } from "@bulletin/core";

/**
 * Group units into waves: a unit joins the first wave in which all of its needs
 * are in earlier waves (spec section 11, scheduling step 2). Units keep plan order
 * inside a wave. Throws an Error whose message contains "cycle" if the edges are not a DAG.
 *
 * Pinned choice: a need naming an id not in the plan throws an Error containing
 * "unknown unit" and the id (the plan is normally validated first).
 */
export function buildWaves(plan: Plan): Unit[][] {
  const ids = new Set(plan.units.map((u) => u.id));
  for (const unit of plan.units) {
    for (const need of unit.needs) {
      if (!ids.has(need.unit)) {
        throw new Error(`unknown unit "${need.unit}" needed by "${unit.id}"`);
      }
    }
  }

  const placed = new Set<string>();
  let remaining = [...plan.units];
  const waves: Unit[][] = [];
  while (remaining.length > 0) {
    const wave = remaining.filter((u) => u.needs.every((n) => placed.has(n.unit)));
    if (wave.length === 0) {
      throw new Error(`cycle among units: ${remaining.map((u) => u.id).join(", ")}`);
    }
    for (const u of wave) placed.add(u.id);
    remaining = remaining.filter((u) => !placed.has(u.id));
    waves.push(wave);
  }
  return waves;
}

/**
 * Units that can start now: status "pending" and every need "merged".
 * A unit missing from `statuses` counts as "pending".
 */
export function readyUnits(plan: Plan, statuses: Readonly<Record<string, UnitStatus>>): Unit[] {
  return plan.units.filter(
    (u) =>
      (statuses[u.id] ?? "pending") === "pending" &&
      u.needs.every((n) => statuses[n.unit] === "merged"),
  );
}

/**
 * Ids of every unit that depends, directly or through other units, on `unitId`.
 * These are marked blocked when `unitId` fails or is held. Plan order, no duplicates,
 * and never includes `unitId` itself.
 */
export function dependentsOf(plan: Plan, unitId: string): string[] {
  const found = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of plan.units) {
      if (found.has(u.id) || u.id === unitId) continue;
      if (u.needs.some((n) => n.unit === unitId || found.has(n.unit))) {
        found.add(u.id);
        grew = true;
      }
    }
  }
  return plan.units.map((u) => u.id).filter((id) => found.has(id));
}
