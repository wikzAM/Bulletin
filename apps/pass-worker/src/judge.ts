import type { PassVerdict } from "@bulletin/core";

export type CommandKind = "test" | "acceptance" | "typecheck" | "lint";

export interface CommandResult {
  kind: CommandKind;
  command: string;
  exitCode: number;
  /** Combined stdout and stderr. */
  output: string;
}

export interface JudgeInput {
  /** The unit's file patterns (globs). */
  unitFiles: readonly string[];
  /** Repo-relative paths changed on the unit branch versus the integration branch. */
  changedFiles: readonly string[];
  /** Paths nothing may change, read from the integration branch. */
  lockedPaths: readonly string[];
  /** Added plus removed lines in the diff. */
  diffLines: number;
  /** Default DEFAULT_LIMITS.maxDiffLines (400). */
  maxDiffLines?: number;
  /** Results of the commands that ran, in the order they ran. May be empty if an earlier rule already failed. */
  commands: readonly CommandResult[];
}

/**
 * The deterministic pass (spec section 11). Rules are checked in this order and the first
 * failure decides the verdict:
 *   0. nothing changed                     -> RED "nothing changed"
 *   1. a changed file is a locked path      -> RED "locked path"     (evidence: the offending paths)
 *   2. a changed file is outside unitFiles  -> RED "out of scope"    (evidence: the offending paths)
 *   3. diffLines over the limit             -> RED "diff too large"  (evidence: "<n> changed lines, limit <max>")
 *   4. first command with a non-zero exit   -> RED "tests failed" | "acceptance failed" |
 *                                              "typecheck failed" | "lint failed" by its kind
 *                                              (evidence: the last 30 lines of its output)
 * Otherwise GREEN with reason "all checks passed" and empty evidence.
 * Locked paths are checked before scope so a station can never hide a rule change.
 *
 * Stub: implemented by a graph unit.
 */
export function judge(_input: JudgeInput): PassVerdict {
  throw new Error("not implemented: judge");
}

/** The last `n` lines of `text` (default 30), without trailing blank lines. */
export function tailLines(_text: string, _n?: number): string {
  throw new Error("not implemented: tailLines");
}
