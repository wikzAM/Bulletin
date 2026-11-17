import type { LanesConfig } from "./config";
import { DEFAULT_LIMITS, LOCKED_PATHS } from "./config";
import { matchesAny } from "./glob";
import { resolveLane } from "./lanes";
import type { Plan, Unit } from "./types";
import { PlanSchema } from "./types";

/** What the validator needs to know about the target repository. */
export interface ValidationContext {
  /** Every tracked file in the repository, repo-relative with forward slashes. */
  repoFiles: readonly string[];
  /** Lanes configuration from .bulletin/lanes.json (or DEFAULT_LANES). */
  lanes: LanesConfig;
  /** Glob-style patterns an acceptance command must match, e.g. "pnpm *". */
  allowedCommands: readonly string[];
  /** Paths no unit may own. Defaults to LOCKED_PATHS. */
  lockedPaths?: readonly string[];
  /** Defaults to DEFAULT_LIMITS.maxUnits (12). */
  maxUnits?: number;
}

export type ValidationResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

/*
 * Choices the spec leaves open:
 * - Error order is deterministic: rule 1, 2, 3, 4, 5, 7 (rule 6 only runs on success); within a
 *   rule, plan order.
 * - Rule 3 reports each cycle found by a depth-first search once (ids in order, closing on the
 *   first id again); a self-need is reported as "a -> a".
 * - Rule 4 reports each overlapping pair of units once, naming the first overlap found
 *   (pattern vs pattern, otherwise a repo file both match).
 * - Rule 5 reports each (unit, pattern) once, even if it hits several locked patterns.
 * - Rule 7 uses a private matcher where "*" matches anything including "/".
 */

/** Pattern overlap, checked in both directions because matchesAny is directional. */
function patternsOverlap(a: string, b: string): boolean {
  return a === b || matchesAny(a, [b]) || matchesAny(b, [a]);
}

function commandAllowed(command: string, allowed: readonly string[]): boolean {
  return allowed.some((pattern) => {
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`, "s").test(command);
  });
}

function findCycles(units: readonly Unit[]): string[][] {
  const ids = new Set(units.map((u) => u.id));
  const needsOf = new Map<string, string[]>();
  for (const u of units) {
    if (!needsOf.has(u.id)) needsOf.set(u.id, u.needs.map((n) => n.unit).filter((id) => ids.has(id)));
  }
  const state = new Map<string, "active" | "done">();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (id: string): void => {
    state.set(id, "active");
    stack.push(id);
    for (const next of needsOf.get(id) ?? []) {
      const s = state.get(next);
      if (s === "active") {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (s === undefined) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, "done");
  };
  for (const u of units) {
    if (!state.has(u.id)) visit(u.id);
  }
  return cycles;
}

/**
 * Validate plan.json before anything runs (spec section 8, rules 1-7).
 * On success the returned plan has every unit's lane already raised to the server's lane (rule 6).
 * On failure `errors` holds one specific message per broken rule.
 */
export function validatePlan(plan: unknown, ctx: ValidationContext): ValidationResult {
  const parsed = PlanSchema.safeParse(plan);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => {
        const path = i.path.join(".");
        return path === "" ? i.message : `${path}: ${i.message}`;
      }),
    };
  }
  const data = parsed.data;
  const units = data.units;
  const errors: string[] = [];

  // Rule 1: unique ids, unit count limit.
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const u of units) {
    if (seen.has(u.id) && !reported.has(u.id)) {
      errors.push(`duplicate unit id: ${u.id}`);
      reported.add(u.id);
    }
    seen.add(u.id);
  }
  const maxUnits = ctx.maxUnits ?? DEFAULT_LIMITS.maxUnits;
  if (units.length > maxUnits) {
    errors.push(`too many units: ${units.length} units, limit ${maxUnits}`);
  }

  // Rule 2: every need names what it reads, and names a unit in the plan.
  for (const u of units) {
    for (const need of u.needs) {
      if (need.reads.trim() === "") {
        errors.push(`fake edge: ${u.id} waits for ${need.unit} but names nothing it reads`);
      }
      if (!seen.has(need.unit)) {
        errors.push(`unknown need: ${u.id} waits for ${need.unit}, which is not a unit in the plan`);
      }
    }
  }

  // Rule 3: DAG.
  for (const cycle of findCycles(units)) {
    errors.push(`cycle in needs: ${cycle.join(" -> ")}`);
  }

  // Rule 4: no pattern belongs to two units.
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      if (!a || !b) continue;
      let found: string | undefined;
      outer: for (const pa of a.files) {
        for (const pb of b.files) {
          if (patternsOverlap(pa, pb)) {
            found = pa === pb ? pa : `${pa} and ${pb}`;
            break outer;
          }
        }
      }
      if (found === undefined) {
        const file = ctx.repoFiles.find((f) => matchesAny(f, a.files) && matchesAny(f, b.files));
        if (file !== undefined) found = file;
      }
      if (found !== undefined) {
        errors.push(`overlapping files: ${a.id} and ${b.id} both own ${found}`);
      }
    }
  }

  // Rule 5: no locked paths.
  const locked = ctx.lockedPaths ?? LOCKED_PATHS;
  for (const u of units) {
    for (const pattern of u.files) {
      const direct = locked.some((l) => patternsOverlap(pattern, l));
      const expanded =
        !direct && ctx.repoFiles.some((f) => matchesAny(f, [pattern]) && matchesAny(f, locked));
      if (direct || expanded) {
        errors.push(`locked path: ${u.id} lists ${pattern}`);
      }
    }
  }

  // Rule 7: acceptance commands.
  for (const u of units) {
    for (const command of u.acceptance) {
      if (!commandAllowed(command, ctx.allowedCommands)) {
        errors.push(`command not allowed: ${u.id} runs "${command}"`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Rule 6: lanes can be raised, never lowered.
  return {
    ok: true,
    plan: {
      ...data,
      units: units.map((u) => ({ ...u, lane: resolveLane(u.files, u.lane, ctx.lanes) })),
    },
  };
}
