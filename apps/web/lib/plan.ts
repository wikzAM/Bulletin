import type { Plan, Unit } from "@bulletin/core";

export interface PlanBatches {
  waves: Unit[][];
  /** Units in a cycle or waiting on a unit the plan lacks. The validator reports why. */
  unplaced: Unit[];
}

/** Group units the way the engine runs them: each joins the first batch after everything it needs. */
export function planBatches(plan: Plan): PlanBatches {
  const placed = new Set<string>();
  const waves: Unit[][] = [];
  let remaining = plan.units;

  for (;;) {
    const wave = remaining.filter((u) => u.needs.every((n) => placed.has(n.unit)));
    if (wave.length === 0) break;
    waves.push(wave);
    for (const u of wave) placed.add(u.id);
    remaining = remaining.filter((u) => !placed.has(u.id));
  }
  return { waves, unplaced: remaining };
}
