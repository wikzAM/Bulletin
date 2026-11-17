import { isLane, isRecord, parsePlan } from "./guards";
import type { InterviewQuestion } from "./interview";
import type { ApproveRefusal, ApproveResult, CreateMissionResponse, MissionDetail, MissionStatus, MissionSummary, PlannedUnit, Question, SettingsInfo, TreasuryInfo } from "./types";

/*
 * Turn API bodies (docs/API.md on codex/warroom-api) into the shapes the pages use. Everything here
 * tolerates missing fields, so a field the API adds later (goal, titles) is picked up without changes.
 */

const MISSION_STATUSES: Record<MissionStatus, true> = { interview: true, planning: true, running: true, finished: true, failed: true };

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function list(body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body[key])) return body[key];
  return [];
}

function toSummary(m: unknown): MissionSummary | null {
  if (!isRecord(m)) return null;
  const id = str(m.id);
  if (!id) return null;
  const status = typeof m.status === "string" && Object.hasOwn(MISSION_STATUSES, m.status) ? (m.status as MissionStatus) : "interview";
  return {
    id,
    goal: str(m.goal) ?? str(m.repo) ?? id,
    status,
    created_at: str(m.created_at) ?? "",
    units_total: num(m.units_total),
    units_done: num(m.units_done),
  };
}

export function toMissionSummaries(body: unknown): MissionSummary[] {
  return list(body, "missions").flatMap((m) => {
    const s = toSummary(m);
    return s ? [s] : [];
  });
}

function toPlannedUnit(u: unknown): PlannedUnit | null {
  if (!isRecord(u)) return null;
  const id = str(u.id);
  if (!id) return null;
  return {
    id,
    title: str(u.title) ?? id,
    lane: isLane(u.lane) ? u.lane : "open",
    wave: num(u.wave) ?? 0,
    needs: Array.isArray(u.needs) ? u.needs.filter((n): n is string => typeof n === "string") : [],
  };
}

export function toMissionDetail(body: unknown): MissionDetail | null {
  const summary = toSummary(body);
  if (!summary || !isRecord(body)) return null;
  const rawUnits = Array.isArray(body.units) ? body.units : [];
  const units = rawUnits.flatMap((u) => {
    const p = toPlannedUnit(u);
    return p ? [p] : [];
  });
  const done = rawUnits.filter((u) => isRecord(u) && u.status === "merged").length;
  return {
    ...summary,
    repo: str(body.repo) ?? "",
    units,
    units_total: summary.units_total ?? units.length,
    units_done: summary.units_done ?? done,
  };
}

export function toTreasuryInfo(body: unknown): TreasuryInfo | null {
  if (!isRecord(body)) return null;
  const budget = num(body.budget_cents);
  return budget === null ? null : { budget_cents: budget };
}

const SOURCES = new Set(["cache", "briefing", "human"]);

export function toQuestion(q: unknown): Question | null {
  if (!isRecord(q)) return null;
  const id = str(q.id);
  const missionId = str(q.mission_id);
  const body = str(q.body);
  if (!id || !missionId || !body) return null;
  const status = q.status === "answered" ? "answered" : "open";
  const source = typeof q.source === "string" && SOURCES.has(q.source) ? (q.source as Question["source"]) : status === "answered" ? "human" : null;
  return {
    id,
    mission_id: missionId,
    unit_id: str(q.unit_id),
    body,
    status,
    answer: str(q.answer),
    source,
    briefing_ref: str(q.briefing_ref),
    auto_result: autoResult(q.auto_result ?? q.answerer_result) ?? (q.auto_answer_tried === true && status === "open" ? "silent" : null),
    created_at: str(q.created_at) ?? "",
    answered_at: str(q.answered_at),
  };
}

function autoResult(value: unknown): Question["auto_result"] {
  const v = typeof value === "string" ? value.toLowerCase() : null;
  return v === "silent" || v === "contradiction" ? v : null;
}

export function toQuestions(body: unknown): Question[] {
  return list(body, "questions").flatMap((q) => {
    const parsed = toQuestion(q);
    return parsed ? [parsed] : [];
  });
}

export type BriefingReply =
  | { kind: "questions"; briefingId: string; questions: InterviewQuestion[] }
  | { kind: "briefing"; briefingId: string; markdown: string };

/**
 * POST /briefings and POST /briefings/:id/answers: either more interviewer questions or the finished
 * Briefing. The shape is assumed until docs/API.md documents the routes, so it accepts several spellings.
 */
export function toBriefingReply(body: unknown): BriefingReply | null {
  if (!isRecord(body)) return null;
  const briefingId = str(body.briefing_id) ?? str(body.id);
  if (!briefingId) return null;
  const markdown = str(body.briefing) ?? str(body.markdown) ?? str(body.text);
  const single = str(body.question);
  const number = num(body.question_number);
  const raw = Array.isArray(body.questions) ? body.questions : single ? [{ id: number === null ? null : String(number), text: single }] : [];
  const questions = raw.flatMap((q, i): InterviewQuestion[] => {
    if (typeof q === "string") return q ? [{ id: `q${i + 1}`, text: q }] : [];
    if (!isRecord(q)) return [];
    const text = str(q.text) ?? str(q.question);
    return text ? [{ id: str(q.id) ?? `q${i + 1}`, text }] : [];
  });
  if (questions.length > 0 && body.status !== "complete") return { kind: "questions", briefingId, questions };
  if (markdown) return { kind: "briefing", briefingId, markdown };
  return null;
}

const APPROVE_REFUSALS: Record<string, ApproveRefusal> = {
  "Mission already approved": "already",
  "Mission has no plan to approve": "no_plan",
  "Plan cannot be priced": "unpriced",
  "Mission runner not configured": "not_configured",
  "Mission pricing not configured": "not_configured",
  "Mission not found": "not_found",
};

/** 202 is ok; the documented refusals become a reason; anything else throws. */
export function toApproveResult(status: number, body: unknown): ApproveResult {
  if (status >= 200 && status < 300) return { ok: true };
  const error = isRecord(body) ? str(body.error) : null;
  if (isRecord(body) && error === "Plan exceeds mission budget") {
    return {
      ok: false,
      reason: "over_budget",
      budget_cents: num(body.budget_cents) ?? 0,
      estimated_cents: num(body.estimated_cents) ?? 0,
      spent_cents: num(body.spent_cents) ?? 0,
      shortfall_cents: num(body.shortfall_cents) ?? 0,
    };
  }
  const reason = error ? APPROVE_REFUSALS[error] : undefined;
  if (reason) return { ok: false, reason };
  throw new Error(error ?? `POST approve failed: ${status}`);
}

/** 201 carries a plan; 422/503 with an errors list are planning failures; anything else throws. */
export function toCreateMissionResponse(status: number, body: unknown): CreateMissionResponse {
  if (isRecord(body)) {
    if (body.ok === true || body.ok === false) return body as unknown as CreateMissionResponse;
    const attempts = num(body.attempts) ?? 1;
    const plan = parsePlan(body.plan);
    if (status >= 200 && status < 300 && plan) return { ok: true, mission_id: str(body.mission_id) ?? "", attempts, plan };
    if (Array.isArray(body.errors)) {
      return { ok: false, mission_id: str(body.mission_id), attempts, errors: body.errors.map(String) };
    }
    if (str(body.error)) throw new Error(String(body.error));
  }
  throw new Error(`POST /missions failed: ${status}`);
}

function records(value: unknown): [string, Record<string, unknown>][] {
  return isRecord(value) ? Object.entries(value).flatMap(([k, v]) => (isRecord(v) ? [[k, v] as [string, Record<string, unknown>]] : [])) : [];
}

/** GET /config is not documented yet (Codex task 18); reads config/models.json and prices.json shapes. */
export function toSettings(body: unknown): SettingsInfo | null {
  if (!isRecord(body)) return null;
  const models = isRecord(body.models) && (isRecord(body.models.roles) || isRecord(body.models.tiers)) ? body.models : body;
  const roles = records(models.roles).flatMap(([role, r]) => {
    const model = str(r.model);
    return model ? [{ role, model, fallback: str(r.fallback), escalate: str(r.escalate) }] : [];
  });
  const tiers = isRecord(models.tiers)
    ? Object.entries(models.tiers).flatMap(([tier, m]) => (str(m) ? [{ tier, model: m as string }] : []))
    : [];
  const priceTable = isRecord(body.prices) ? body.prices : {};
  const prices = records(priceTable.models).flatMap(([model, p]) => {
    const input = num(p.input);
    const output = num(p.output);
    return input !== null && output !== null ? [{ model, input, output }] : [];
  });
  const limits: Record<string, number> = {};
  if (isRecord(body.limits)) for (const [k, v] of Object.entries(body.limits)) if (num(v) !== null) limits[k] = v as number;
  const defaultBudgetCents = num(body.default_budget_cents);
  if (roles.length === 0 && tiers.length === 0 && prices.length === 0 && Object.keys(limits).length === 0 && defaultBudgetCents === null) return null;
  return { roles, tiers, prices, pricesAsOf: str(priceTable.as_of), limits, defaultBudgetCents };
}
/** GET /missions/:id/treasury: total spend (cost_cents) and the budget, which may be null. */
export function toSpendInfo(body: unknown): { spent_cents: number; budget_cents: number | null } | null {
  if (!isRecord(body)) return null;
  const spent = num(body.cost_cents) ?? num(body.spent_cents);
  const budget = num(body.budget_cents);
  if (spent === null && budget === null) return null;
  return { spent_cents: spent ?? 0, budget_cents: budget };
}