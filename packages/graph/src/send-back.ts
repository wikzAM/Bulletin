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
export function formatSendBack(input: SendBackInput): string {
  // Pinned choice: no trailing newline after the last line.
  const pad = (label: string): string => label.padEnd(10);
  const { verdict } = input;
  const evidenceLines = verdict.evidence.trim() === "" ? ["-"] : verdict.evidence.split(/\r?\n/);
  const lines = [
    `${pad("UNIT")}${input.unitId}`,
    `${pad("VERDICT")}${verdict.verdict.toUpperCase()} (attempt ${input.attempt} of ${input.maxAttempts})`,
    `${pad("REASON")}${verdict.reason}`,
    ...evidenceLines.map((line, i) => (i === 0 ? pad("EVIDENCE") : " ".repeat(10)) + line),
    `${pad("SCOPE")}fix this unit only. Touch only: ${input.files.join(", ")}`,
  ];
  return lines.join("\n");
}

/**
 * One line for .bulletin/lessons.md, written on every send-back:
 * "- <reason> (<unitId>: <title>)". Newlines in any part are collapsed to spaces.
 */
export function lessonLine(unitId: string, title: string, reason: string): string {
  const clean = (part: string): string => part.replace(/[\r\n]+/g, " ").trim();
  return `- ${clean(reason)} (${clean(unitId)}: ${clean(title)})`;
}

/** Append one lesson line to the current contents of lessons.md, ending with exactly one newline. */
export function appendLesson(lessons: string, line: string): string {
  const base = lessons !== "" && !lessons.endsWith("\n") ? `${lessons}\n` : lessons;
  return `${base}${line.replace(/[\r\n]+$/, "")}\n`;
}

/**
 * Any lesson reason that appears twice or more in `lessons` becomes one line in rules.md:
 * `- Cut units so this cannot recur: <reason>`. A reason already present in `rules`
 * is not added again. Returns the new contents of rules.md (unchanged if nothing was promoted).
 * The reason is the text between "- " and the trailing " (<unitId>: <title>)".
 */
export function promoteLessons(lessons: string, rules: string): string {
  // Pinned choices: reasons are counted after trim; "already in rules" is an exact
  // line match (not substring); new rules appear in order of first appearance.
  const counts = new Map<string, number>();
  for (const line of lessons.split(/\r?\n/)) {
    const m = /^- (.*) \(([^\s:()]+): (.*)\)$/.exec(line);
    if (!m) continue;
    const reason = (m[1] ?? "").trim();
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const existing = new Set(rules.split(/\r?\n/));
  let result = rules;
  for (const [reason, count] of counts) {
    if (count < 2) continue;
    const line = `- Cut units so this cannot recur: ${reason}`;
    if (existing.has(line)) continue;
    existing.add(line);
    result = appendLesson(result, line);
  }
  return result;
}
