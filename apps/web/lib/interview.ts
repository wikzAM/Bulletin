import { copy } from "./copy";
import type { CreateMissionResponse } from "./types";

/** Spec F1: up to 10 plain-language questions, one at a time, each skippable. */
export const MAX_QUESTIONS = 10;
export const BRIEFING_MAX_LENGTH = 20_000;
const TITLE_MAX = 80;

export type FlowStep = "goal" | "interview" | "review" | "plan";

export interface InterviewQuestion {
  id: string;
  text: string;
}

export interface FlowState {
  step: FlowStep;
  goal: string;
  repo: string;
  briefingId: string | null;
  questions: InterviewQuestion[];
  /** Index of the question on screen; equal to questions.length once all are answered or skipped. */
  index: number;
  /** null means skipped. */
  answers: Record<string, string | null>;
  briefing: string;
  edited: boolean;
  plan: CreateMissionResponse | null;
  busy: boolean;
  error: string | null;
  notice: "noInterviewer" | null;
}

export type FlowAction =
  | { type: "start"; goal: string; repo: string }
  | { type: "questions"; briefingId: string; questions: InterviewQuestion[] }
  | { type: "answer"; text: string }
  | { type: "skip" }
  | { type: "back" }
  | { type: "noInterviewer" }
  | { type: "briefing"; markdown: string }
  | { type: "edit"; markdown: string }
  | { type: "submit" }
  | { type: "plan"; result: CreateMissionResponse }
  | { type: "review" }
  | { type: "fail"; message: string }
  | { type: "restart" };

export const initialFlow: FlowState = {
  step: "goal",
  goal: "",
  repo: "",
  briefingId: null,
  questions: [],
  index: 0,
  answers: {},
  briefing: "",
  edited: false,
  plan: null,
  busy: false,
  error: null,
  notice: null,
};

function record(state: FlowState, answer: string | null): FlowState {
  const q = state.questions[state.index];
  if (!q) return state;
  return { ...state, answers: { ...state.answers, [q.id]: answer }, index: state.index + 1, error: null };
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "start":
      return { ...state, goal: action.goal, repo: action.repo, busy: true, error: null, notice: null };
    case "questions": {
      const known = new Set(state.questions.map((q) => q.id));
      const fresh = action.questions.filter((q) => !known.has(q.id));
      const questions = [...state.questions, ...fresh].slice(0, MAX_QUESTIONS);
      return { ...state, step: "interview", briefingId: action.briefingId, questions, busy: false, error: null };
    }
    case "answer":
      return record(state, action.text.trim() || null);
    case "skip":
      return record(state, null);
    case "back":
      return { ...state, index: Math.max(0, state.index - 1), error: null };
    case "noInterviewer":
      return { ...state, step: "review", briefing: briefingFromGoal(state.goal), edited: false, busy: false, notice: "noInterviewer" };
    case "briefing":
      return { ...state, step: "review", briefing: action.markdown, edited: false, busy: false, error: null };
    case "edit":
      return { ...state, briefing: action.markdown, edited: true, error: null };
    case "submit":
      return { ...state, busy: true, error: null };
    case "plan":
      return { ...state, step: "plan", plan: action.result, busy: false, error: null };
    case "review":
      return { ...state, step: "review", plan: null, busy: false, error: null };
    case "fail":
      return { ...state, busy: false, error: action.message };
    case "restart":
      return initialFlow;
  }
}

export function currentQuestion(state: FlowState): InterviewQuestion | null {
  return state.questions[state.index] ?? null;
}

export function progress(state: FlowState): { n: number; total: number } {
  return { n: Math.min(state.index + 1, state.questions.length), total: state.questions.length };
}

export function answersPayload(state: FlowState): { question_id: string; answer: string | null }[] {
  return state.questions.map((q) => ({ question_id: q.id, answer: state.answers[q.id] ?? null }));
}

/** The spec's Briefing template (section 8) with only the goal filled in. */
export function briefingFromGoal(goal: string): string {
  const text = goal.trim();
  const firstLine = text.split("\n")[0] ?? "";
  const title = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : firstLine;
  return [
    `# Briefing: ${title}`,
    "## Goal",
    text,
    "## Users",
    "## Features",
    "## Constraints",
    "## Out of scope",
    "## Decisions log",
    "",
  ].join("\n");
}

/** The text under `## Goal`, or the whole text when there is no such section. */
export function briefingGoal(markdown: string): string {
  const match = /^## Goal[^\n]*\n([\s\S]*?)(?=^#{1,2} |(?![\s\S]))/m.exec(markdown);
  return (match?.[1] ?? markdown).trim();
}

export function validateBriefing(text: string): { ok: true; value: string } | { ok: false; error: string } {
  const e = copy.newMission.errors;
  const value = text.trim();
  if (value.length === 0) return { ok: false, error: e.briefingEmpty };
  if (value.length > BRIEFING_MAX_LENGTH) return { ok: false, error: e.briefingLong(BRIEFING_MAX_LENGTH) };
  if (!/^## Goal\b/m.test(value)) return { ok: false, error: e.briefingGoal };
  return { ok: true, value };
}
