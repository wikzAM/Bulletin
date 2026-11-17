import { copy } from "./copy";
import type { Question } from "./types";

export const ANSWER_MAX_LENGTH = 4000;

export type QuestionFilter = "open" | "answered" | "all";
export type ChipTone = "open" | "needs-you" | "human" | "briefing" | "cache" | "answered";

export function questionChip(q: Question): { tone: ChipTone; label: string; icon: string } {
  const chips = copy.questions.chips;
  if (q.status === "open") return q.auto_result ? { tone: "needs-you", ...chips.needsYou } : { tone: "open", ...chips.open };
  if (q.source) return { tone: q.source, ...chips[q.source] };
  return { tone: "answered", ...chips.answered };
}

export type Answerer = "person" | "requirements" | "earlier" | "unknown";

export function answeredBy(q: Question): { who: Answerer; text: string } | null {
  if (q.status !== "answered") return null;
  const t = copy.questions.answeredBy;
  const who: Answerer = q.source === "human" ? "person" : q.source === "briefing" ? "requirements" : q.source === "cache" ? "earlier" : "unknown";
  const text = q.briefing_ref && who !== "person" && who !== "unknown" ? t.section(t[who], q.briefing_ref) : t[who];
  return { who, text };
}

/** Why the automatic answerer handed an open question to a person, if it was tried. */
export function handoverReason(q: Question): string | null {
  if (q.status !== "open" || !q.auto_result) return null;
  return copy.questions.handover[q.auto_result];
}

/** Open questions first, newest first inside each group. */
export function sortQuestions(list: Question[]): Question[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

export function countQuestions(list: Question[]): Record<QuestionFilter, number> {
  const open = list.filter((q) => q.status === "open").length;
  return { all: list.length, open, answered: list.length - open };
}

export function filterQuestions(list: Question[], filter: QuestionFilter): Question[] {
  return filter === "all" ? list : list.filter((q) => q.status === filter);
}

/** Read ?status= from the URL. Defaults to open, since those are the ones that need a person. */
export function parseFilter(value: string | string[] | undefined): QuestionFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "answered" || v === "all" ? v : "open";
}

export function validateAnswer(text: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = text.trim();
  if (value.length === 0) return { ok: false, error: copy.questions.errors.empty };
  if (value.length > ANSWER_MAX_LENGTH) return { ok: false, error: copy.questions.errors.tooLong(ANSWER_MAX_LENGTH) };
  return { ok: true, value };
}

export function replaceQuestion(list: Question[], updated: Question): Question[] {
  return list.map((q) => (q.id === updated.id ? updated : q));
}
