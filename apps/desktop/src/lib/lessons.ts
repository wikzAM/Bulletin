export interface LessonItem {
  reason: string;
  /** Null for a line a person wrote by hand. */
  taskId: string | null;
  taskTitle: string | null;
}

export interface RuleItem {
  text: string;
  /** True for a rule promoted from a lesson that happened twice. */
  learned: boolean;
}

/** The line packages/graph lessonLine writes: `- <reason> (<unitId>: <title>)`. */
const LESSON_LINE = /^- (.*) \(([^\s:()]+): (.*)\)$/;
const LEARNED_PREFIX = "Cut units so this cannot recur: ";

function bullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("- ") && line.length > 2);
}

/** Lessons are appended one per send-back, so the newest is last in the file and first here. */
export function parseLessons(markdown: string): LessonItem[] {
  return bullets(markdown)
    .map((line) => {
      const m = LESSON_LINE.exec(line);
      if (m) return { reason: (m[1] ?? "").trim(), taskId: m[2] ?? null, taskTitle: m[3] ?? null };
      return { reason: line.slice(2).trim(), taskId: null, taskTitle: null };
    })
    .reverse();
}

export function parseRules(markdown: string): RuleItem[] {
  return bullets(markdown)
    .map((line) => {
      const text = line.slice(2).trim();
      return text.startsWith(LEARNED_PREFIX) ? { text: text.slice(LEARNED_PREFIX.length).trim(), learned: true } : { text, learned: false };
    })
    .reverse();
}
