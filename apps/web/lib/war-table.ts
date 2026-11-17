import type { BulletinEvent, EventType, Lane, UnitStatus } from "@bulletin/core";
import { formatCents } from "./format";
import { isLane, parsePlan } from "./guards";
import { planBatches } from "./plan";
import type { PlannedUnit } from "./types";

/** What one task card shows. Built only from the plan and the event log. */
export interface UnitCard {
  id: string;
  title: string;
  lane: Lane;
  /** Wave from the plan; 0 for a unit the plan did not list. */
  wave: number;
  status: UnitStatus;
  attempts: number;
  spent_cents: number;
  last_reason: string | null;
  started: boolean;
  /** One entry per try, oldest first. */
  history: AttemptRecord[];
  /** Set when the task is held for a person's OK (decision.opened), with the choice once made. */
  decision: UnitDecision | null;
}

export type DecisionChoice = "approve" | "reject";

export interface UnitDecision {
  kind: "closed_lane_merge" | "gated_retry";
  branch: string | null;
  choice: DecisionChoice | null;
}

export type AttemptResult = "green" | "red" | "error" | "cancelled";

export interface AttemptRecord {
  attempt: number;
  /** Null when the verdict arrived without an attempt.started in the stream. */
  started_at: string | null;
  result: AttemptResult | null;
  reason: string | null;
  evidence: string | null;
  /** The send-back packet text, when the event carries it. */
  packet: string | null;
  sent_back: boolean;
  spent_cents: number;
}

export interface FeedItem {
  id: number;
  ts: string;
  type: EventType;
  unit_id: string | null;
  payload: Record<string, unknown>;
}

export interface WarTableState {
  lastEventId: number;
  order: string[];
  units: Record<string, UnitCard>;
  feed: FeedItem[];
  finished: boolean;
  /** How mission.finished ended the project; null until it arrives. */
  ending: Ending | null;
  /** Set by plan.approved. */
  approved: boolean;
  /** Set by budget.paused; cleared when any attempt starts again. */
  paused: boolean;
}

export type Ending = "done" | "stopped" | "interrupted" | "failed";

export function endingOf(payload: Record<string, unknown>): Ending {
  if (payload.stopped === true) return "stopped";
  if (payload.interrupted === true) return "interrupted";
  if (payload.status === "failed") return "failed";
  return "done";
}

export const FEED_LIMIT = 200;

const STATUS_ON: Partial<Record<EventType, UnitStatus>> = {
  "unit.started": "running",
  "attempt.started": "running",
  "pass.green": "green",
  "pass.red": "red",
  "unit.sent_back": "red",
  "unit.merged": "merged",
  "unit.held": "held",
  "unit.failed": "failed",
  "unit.blocked": "blocked",
};

const UNIT_EVENTS = new Set<EventType>([...(Object.keys(STATUS_ON) as EventType[]), "ledger.charged", "attempt.ended", "decision.opened", "decision.resolved"]);

const MERGE_DECISIONS = new Set<unknown>(["closed_lane_merge", "gated_retry"]);

function choiceOf(value: unknown): DecisionChoice | null {
  return value === "approve" || value === "reject" ? value : null;
}

const ENDED_RESULTS = new Set<unknown>(["green", "red", "error", "cancelled"]);

function card(unit: Pick<PlannedUnit, "id" | "title" | "lane" | "wave">): UnitCard {
  return { ...unit, status: "pending", attempts: 0, spent_cents: 0, last_reason: null, started: false, history: [], decision: null };
}

function newAttempt(attempt: number, startedAt: string | null): AttemptRecord {
  return { attempt, started_at: startedAt, result: null, reason: null, evidence: null, packet: null, sent_back: false, spent_cents: 0 };
}

/**
 * Apply a change to the try an event belongs to: payload.attempt when given, else the latest try.
 * A verdict for a try the stream never started creates it.
 */
function updateAttempt(history: AttemptRecord[], attempt: number | null, change: (a: AttemptRecord) => AttemptRecord): AttemptRecord[] {
  const index = attempt === null ? history.length - 1 : history.findIndex((a) => a.attempt === attempt);
  if (index >= 0) return history.map((a, i) => (i === index ? change(a) : a));
  return [...history, change(newAttempt(attempt ?? history.length + 1, null))];
}

function updateHistory(history: AttemptRecord[], event: BulletinEvent): AttemptRecord[] {
  const p = event.payload;
  const n = num(p.attempt);
  switch (event.type) {
    case "attempt.started":
      return [...history, newAttempt(n ?? history.length + 1, event.ts)];
    case "ledger.charged":
      if (history.length === 0) return history;
      return updateAttempt(history, n, (a) => ({ ...a, spent_cents: a.spent_cents + (num(p.cost_cents) ?? 0) }));
    case "pass.green":
    case "pass.red":
      return updateAttempt(history, n, (a) => ({
        ...a,
        result: event.type === "pass.green" ? "green" : "red",
        reason: str(p.reason) ?? a.reason,
        evidence: str(p.evidence) ?? a.evidence,
      }));
    case "attempt.ended":
      if (!ENDED_RESULTS.has(p.result)) return history;
      return updateAttempt(history, n, (a) => ({ ...a, result: a.result ?? (p.result as AttemptResult) }));
    case "unit.sent_back":
      return updateAttempt(history, n, (a) => ({
        ...a,
        sent_back: true,
        reason: a.reason ?? str(p.reason),
        packet: str(p.packet) ?? a.packet,
      }));
    default:
      return history;
  }
}

export function initialState(units: PlannedUnit[]): WarTableState {
  return {
    lastEventId: 0,
    order: units.map((u) => u.id),
    units: Object.fromEntries(units.map((u) => [u.id, card(u)])),
    feed: [],
    finished: false,
    ending: null,
    approved: false,
    paused: false,
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function updateUnit(prev: UnitCard, event: BulletinEvent): UnitCard {
  const next: UnitCard = { ...prev };
  const status = STATUS_ON[event.type];
  if (status) next.status = status;
  const p = event.payload;

  switch (event.type) {
    case "unit.started":
      next.started = true;
      if (isLane(p.lane)) next.lane = p.lane;
      break;
    case "attempt.started":
      next.started = true;
      next.attempts = num(p.attempt) ?? prev.attempts + 1;
      break;
    case "pass.red":
    case "unit.sent_back":
    case "unit.failed":
      next.last_reason = str(p.reason) ?? prev.last_reason;
      break;
    case "ledger.charged":
      next.spent_cents = prev.spent_cents + (num(p.cost_cents) ?? 0);
      break;
    case "decision.opened":
      if (MERGE_DECISIONS.has(p.kind)) next.decision = { kind: p.kind as UnitDecision["kind"], branch: str(p.branch), choice: null };
      break;
    case "decision.resolved": {
      const choice = choiceOf(p.choice);
      if (choice) next.decision = { kind: prev.decision?.kind ?? (prev.lane === "closed" ? "closed_lane_merge" : "gated_retry"), branch: prev.decision?.branch ?? null, choice };
      break;
    }
    default:
      break;
  }
  next.history = updateHistory(prev.history, event);
  return next;
}

/** A plan in plan.proposed names every unit; it sets titles, lanes and batches but not live state. */
function applyPlan(order: string[], units: Record<string, UnitCard>, value: unknown) {
  const plan = parsePlan(value);
  if (!plan) return { order, units };
  const next = { ...units };
  const nextOrder = [...order];
  planBatches(plan).waves.forEach((wave, i) => {
    for (const u of wave) {
      const prev = next[u.id];
      if (!prev) nextOrder.push(u.id);
      next[u.id] = { ...(prev ?? card({ id: u.id, title: u.title, lane: u.lane, wave: i + 1 })), title: u.title, lane: u.lane, wave: i + 1 };
    }
  });
  return { order: nextOrder, units: next };
}

/** Fold one event into the state. Returns the same object for an event already applied. */
export function applyEvent(state: WarTableState, event: BulletinEvent): WarTableState {
  if (event.id <= state.lastEventId) return state;

  const item: FeedItem = { id: event.id, ts: event.ts, type: event.type, unit_id: event.unit_id, payload: event.payload };
  const feed = [...state.feed, item].slice(-FEED_LIMIT);
  let { order, units } = state;

  if (event.type === "plan.proposed") ({ order, units } = applyPlan(order, units, event.payload.plan));

  const unitId = event.unit_id;
  const isDecision = event.type === "decision.opened" || event.type === "decision.resolved";
  if (unitId && UNIT_EVENTS.has(event.type) && (!isDecision || units[unitId])) {
    const prev = units[unitId];
    if (!prev) order = [...order, unitId];
    units = { ...units, [unitId]: updateUnit(prev ?? card({ id: unitId, title: unitId, lane: "open", wave: 0 }), event) };
  }

  return {
    lastEventId: event.id,
    order,
    units,
    feed,
    finished: state.finished || event.type === "mission.finished",
    ending: event.type === "mission.finished" ? endingOf(event.payload) : state.ending,
    approved: state.approved || event.type === "plan.approved",
    paused: event.type === "budget.paused" ? true : event.type === "attempt.started" ? false : state.paused,
  };
}

/** Cards grouped by batch, batches ascending, plan order kept inside each batch. */
export function groupWaves(state: WarTableState): [wave: number, cards: UnitCard[]][] {
  const byWave = new Map<number, UnitCard[]>();
  for (const id of state.order) {
    const unit = state.units[id];
    if (!unit) continue;
    byWave.set(unit.wave, [...(byWave.get(unit.wave) ?? []), unit]);
  }
  return [...byWave.entries()].sort(([a], [b]) => a - b);
}

export function unitTitles(state: WarTableState): Record<string, string> {
  return Object.fromEntries(Object.values(state.units).map((u) => [u.id, u.title]));
}

export function reduceEvents(units: PlannedUnit[], events: BulletinEvent[]): WarTableState {
  return events.reduce(applyEvent, initialState(units));
}

type Describer = (p: Record<string, unknown>) => string;

const FINISHED_TEXT: Record<Ending, string> = {
  done: "Project finished",
  stopped: "Project stopped by a person",
  interrupted: "Project interrupted: the server restarted before it finished",
  failed: "Project failed",
};

const MISSION_TEXT: Record<string, Describer> = {
  "mission.created": () => "Project created",
  "briefing.versioned": (p) => (num(p.version) ? `Requirements updated to version ${num(p.version)}` : "Requirements updated"),
  "plan.proposed": (p) => (num(p.units) ? `Plan proposed with ${num(p.units)} tasks` : "Plan proposed"),
  "plan.approved": () => "Plan approved",
  "wave.started": (p) => (num(p.wave) ? `Batch ${num(p.wave)} started` : "Next batch started"),
  "budget.paused": () => "Paused: the budget would be exceeded",
  "mission.finished": (p) => FINISHED_TEXT[endingOf(p)],
};

const UNIT_TEXT: Record<string, Describer> = {
  "unit.started": () => "work started",
  "attempt.started": (p) => (num(p.attempt) ? `try ${num(p.attempt)} started` : "new try started"),
  "attempt.ended": (p) => (num(p.attempt) ? `try ${num(p.attempt)} ended` : "try ended"),
  "dispatch.asked": () => "asked a question",
  "dispatch.answered": () => "question answered",
  "dispatch.escalated": () => "question sent to a person",
  "dispatch.posted": () => "posted an update",
  "decision.opened": () => "needs a decision",
  "decision.resolved": (p) => (p.choice === "approve" ? "approved" : p.choice === "reject" ? "rejected" : "decision made"),
  "pass.green": () => "checks passed",
  "pass.red": (p) => (str(p.reason) ? `checks failed (${str(p.reason)})` : "checks failed"),
  "unit.sent_back": (p) => (str(p.reason) ? `sent back to fix: ${str(p.reason)}` : "sent back to fix"),
  "unit.merged": () => "done and added to the project",
  "unit.held": () => "waiting for approval",
  "unit.failed": (p) => (str(p.reason) ? `failed (${str(p.reason)})` : "failed"),
  "unit.blocked": () => "blocked by an earlier task",
  "ledger.charged": (p) => `spent ${formatCents(num(p.cost_cents) ?? 0)}`,
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One plain-language line for the activity feed. */
export function describeEvent(event: Pick<BulletinEvent, "type" | "unit_id" | "payload">, titles: Record<string, string>): string {
  const p = event.payload;
  const unitText = UNIT_TEXT[event.type];
  if (event.unit_id && unitText) return `${titles[event.unit_id] ?? event.unit_id}: ${unitText(p)}`;
  const missionText = MISSION_TEXT[event.type];
  if (missionText) return missionText(p);
  return unitText ? capitalize(unitText(p)) : event.type;
}
