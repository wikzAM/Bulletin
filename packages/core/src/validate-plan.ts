import type { LanesConfig } from "./config";
import type { Plan } from "./types";

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

/**
 * Validate plan.json before anything runs (spec section 8, rules 1-7).
 * On success the returned plan has every unit's lane already raised to the server's lane (rule 6).
 * On failure `errors` holds one specific message per broken rule.
 *
 * Stub: implemented by a graph unit.
 */
export function validatePlan(_plan: unknown, _ctx: ValidationContext): ValidationResult {
  throw new Error("not implemented: validatePlan");
}
