import type { PassVerdict } from "@bulletin/core";

export interface SendBackInput {
  unitId: string;
  /** The attempt that just came back RED, starting at 1. */
  attempt: number;
  maxAttempts: number;
  verdict: PassVerdict;
  /** The unit's file patterns; the only things the next attempt may touch. */
  files: readonly string[];
}

/**
 * The packet a RED unit receives (spec section 11). Sent to that unit only. Exact shape:
 *
 * UNIT      u4
 * VERDICT   RED (attempt 1 of 3)
 * REASON    tests failed
 * EVIDENCE  first evidence line
 *           following evidence lines, indented to the same column
 * SCOPE     fix this unit only. Touch only: a.ts, b.ts
 *
 * Labels are padded to a 10-character column. Empty evidence prints "-".
 *
 * Stub: implemented by a graph unit.
 */
export function formatSendBack(_input: SendBackInput): string {
  throw new Error("not implemented: formatSendBack");
}

/**
 * One line for .bulletin/lessons.md, written on every send-back:
 * "- <reason> (<unitId>: <title>)". Newlines in any part are collapsed to spaces.
 */
export function lessonLine(_unitId: string, _title: string, _reason: string): string {
  throw new Error("not implemented: lessonLine");
}

/** Append one lesson line to the current contents of lessons.md, ending with exactly one newline. */
export function appendLesson(_lessons: string, _line: string): string {
  throw new Error("not implemented: appendLesson");
}

/**
 * Any lesson reason that appears twice or more in `lessons` becomes one line in rules.md:
 * `- Cut units so this cannot recur: <reason>`. A reason already present in `rules`
 * is not added again. Returns the new contents of rules.md (unchanged if nothing was promoted).
 * The reason is the text between "- " and the trailing " (<unitId>: <title>)".
 */
export function promoteLessons(_lessons: string, _rules: string): string {
  throw new Error("not implemented: promoteLessons");
}
