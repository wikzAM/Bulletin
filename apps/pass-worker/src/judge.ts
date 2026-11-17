import type { PassVerdict } from "@bulletin/core";
import { DEFAULT_LIMITS, matchesAny, normalizePath } from "@bulletin/core";

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

const FAIL_REASON: Record<CommandKind, string> = {
  test: "tests failed",
  acceptance: "acceptance failed",
  typecheck: "typecheck failed",
  lint: "lint failed",
};

function red(reason: string, evidence: string): PassVerdict {
  return { verdict: "red", reason, evidence };
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
 * Choices left open by the spec: offending paths are reported normalized (backslashes to
 * slashes, leading "./" dropped), in input order; a diff exactly at the limit passes.
 */
export function judge(input: JudgeInput): PassVerdict {
  if (input.changedFiles.length === 0) return red("nothing changed", "");

  const locked = input.changedFiles.filter((f) => matchesAny(f, input.lockedPaths));
  if (locked.length > 0) return red("locked path", locked.map(normalizePath).join("\n"));

  const outside = input.changedFiles.filter((f) => !matchesAny(f, input.unitFiles));
  if (outside.length > 0) return red("out of scope", outside.map(normalizePath).join("\n"));

  const max = input.maxDiffLines ?? DEFAULT_LIMITS.maxDiffLines;
  if (input.diffLines > max) {
    return red("diff too large", `${input.diffLines} changed lines, limit ${max}`);
  }

  const failed = input.commands.find((c) => c.exitCode !== 0);
  if (failed) {
    return red(FAIL_REASON[failed.kind], tailLines(failed.output, DEFAULT_LIMITS.evidenceLines));
  }

  return { verdict: "green", reason: "all checks passed", evidence: "" };
}

/** The last `n` lines of `text` (default 30), without trailing blank lines. */
export function tailLines(text: string, n = 30): string {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  if (n <= 0) return "";
  return lines.slice(-n).join("\n");
}
