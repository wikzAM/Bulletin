import type { Lane, Plan } from "@bulletin/core";

/**
 * Response shapes the web app expects from the API (GET /missions, GET /missions/:id).
 * Assumed until docs/API.md lands; only lib/api.ts and lib/mock.ts produce these.
 */
export type MissionStatus = "interview" | "planning" | "running" | "finished" | "failed";

export interface MissionSummary {
  id: string;
  goal: string;
  status: MissionStatus;
  created_at: string;
  /** Null when the API does not report counts. */
  units_total: number | null;
  units_done: number | null;
}

/** A unit as the approved plan describes it. Live status comes from the event stream, not from here. */
export interface PlannedUnit {
  id: string;
  title: string;
  lane: Lane;
  wave: number;
  needs: string[];
}

/** GET /missions/:id/treasury. Spend is taken from ledger.charged events, so only the budget is needed here. */
export interface TreasuryInfo {
  budget_cents: number;
}

/** A station question on the board (GET /questions, POST /questions/:id/answer). */
export interface Question {
  id: string;
  mission_id: string;
  unit_id: string | null;
  body: string;
  status: "open" | "answered";
  answer: string | null;
  /** Who answered: the answer cache, the Briefing, or a person. Null while open. */
  source: "cache" | "briefing" | "human" | null;
  briefing_ref: string | null;
  /** The automatic answerer's verdict when it was tried and handed the question to a person. */
  auto_result: "silent" | "contradiction" | null;
  created_at: string;
  answered_at: string | null;
}

/** POST /missions with { goal, repo }: the General's result, shaped like its GeneralResult. */
export type CreateMissionResponse =
  | { ok: true; mission_id: string; plan: Plan; attempts: number }
  | { ok: false; mission_id: string | null; errors: string[]; attempts: number };

export type ApproveRefusal = "already" | "no_plan" | "unpriced" | "not_configured" | "not_found";

export type ApproveResult =
  | { ok: true }
  | { ok: false; reason: "over_budget"; budget_cents: number; estimated_cents: number; spent_cents: number; shortfall_cents: number }
  | { ok: false; reason: ApproveRefusal };

export interface MissionDetail extends MissionSummary {
  repo: string;
  units: PlannedUnit[];
}

/** What GET /config reports for the settings page: models per job, prices and limits. No secrets. */
export interface SettingsInfo {
  roles: { role: string; model: string; fallback: string | null; escalate: string | null }[];
  tiers: { tier: string; model: string }[];
  prices: { model: string; input: number; output: number }[];
  pricesAsOf: string | null;
  limits: Record<string, number>;
  defaultBudgetCents: number | null;
}