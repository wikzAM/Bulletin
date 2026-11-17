import type { Plan, Unit, UnitStatus } from "@bulletin/core";

/**
 * Group units into waves: a unit joins the first wave in which all of its needs
 * are in earlier waves (spec section 11, scheduling step 2). Units keep plan order
 * inside a wave. Throws an Error whose message contains "cycle" if the edges are not a DAG.
 *
 * Stub: implemented by a graph unit.
 */
export function buildWaves(_plan: Plan): Unit[][] {
  throw new Error("not implemented: buildWaves");
}

/**
 * Units that can start now: status "pending" and every need "merged".
 * A unit missing from `statuses` counts as "pending".
 */
export function readyUnits(_plan: Plan, _statuses: Readonly<Record<string, UnitStatus>>): Unit[] {
  throw new Error("not implemented: readyUnits");
}

/**
 * Ids of every unit that depends, directly or through other units, on `unitId`.
 * These are marked blocked when `unitId` fails or is held. Plan order, no duplicates,
 * and never includes `unitId` itself.
 */
export function dependentsOf(_plan: Plan, _unitId: string): string[] {
  throw new Error("not implemented: dependentsOf");
}
