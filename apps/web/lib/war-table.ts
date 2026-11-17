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
  /** Set by budget.paused; cleared when any attempt starts again. */
  paused: boolean;
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

function card(unit: Pick<PlannedUnit, "id" | "title" | "lane" | "wave">): UnitCard {
  return { ...unit, status: "pending", attempts: 0, spent_cents: 0, last_reason: null, started: false };
}

export function initialState(units: PlannedUnit[]): WarTableState {
  return {
    lastEventId: 0,
    order: units.map((u) => u.id),
    units: Object.fromEntries(units.map((u) => [u.id, card(u)])),
    feed: [],
    finished: false,
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
    default:
      break;
  }
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
  if (unitId && (event.type in STATUS_ON || event.type === "ledger.charged")) {
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
    paused: event.type === "budget.paused" ? true : event.type === "attempt.started" ? false : state.paused,
  };
}

export function reduceEvents(units: PlannedUnit[], events: BulletinEvent[]): WarTableState {
  return events.reduce(applyEvent, initialState(units));
}

type Describer = (p: Record<string, unknown>) => string;

const MISSION_TEXT: Record<string, Describer> = {
  "mission.created": () => "Project created",
  "briefing.versioned": (p) => (num(p.version) ? `Requirements updated to version ${num(p.version)}` : "Requirements updated"),
  "plan.proposed": (p) => (num(p.units) ? `Plan proposed with ${num(p.units)} tasks` : "Plan proposed"),
  "plan.approved": () => "Plan approved",
  "wave.started": (p) => (num(p.wave) ? `Batch ${num(p.wave)} started` : "Next batch started"),
  "budget.paused": () => "Paused: the budget would be exceeded",
  "mission.finished": () => "Project finished",
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
  "decision.resolved": () => "decision made",
  "pass.green": () => "checks passed",
  "pass.red": (p) => (str(p.reason) ? `checks failed (${str(p.reason)})` : "checks failed"),
  "unit.sent_back": (p) => (str(p.reason) ? `sent back to fix: ${str(p.reason)}` : "sent back to fix"),
  "unit.merged": () => "done and merged",
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
