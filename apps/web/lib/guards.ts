import type { BulletinEvent, EventType, Lane, Plan, Unit } from "@bulletin/core";

/*
 * Browser code may import only types from @bulletin/core: its index also exports config.ts, which
 * reads node:fs. These records are keyed by the core types, so adding a lane or event type there
 * fails the typecheck here until it is listed.
 */
const LANE_SET: Record<Lane, true> = { open: true, gated: true, closed: true };

const EVENT_TYPE_SET: Record<EventType, true> = {
  "mission.created": true,
  "mission.interrupted": true,
  "mission.resumed": true,
  "mission.archived": true,
  "mission.unarchived": true,
  "briefing.versioned": true,
  "plan.proposed": true,
  "plan.approved": true,
  "wave.started": true,
  "unit.started": true,
  "attempt.started": true,
  "attempt.ended": true,
  "dispatch.asked": true,
  "dispatch.answered": true,
  "dispatch.escalated": true,
  "dispatch.posted": true,
  "decision.opened": true,
  "decision.resolved": true,
  "pass.green": true,
  "pass.red": true,
  "unit.sent_back": true,
  "unit.merged": true,
  "unit.held": true,
  "unit.failed": true,
  "unit.blocked": true,
  "ledger.charged": true,
  "budget.paused": true,
  "mission.finished": true,
};

export const EVENT_TYPE_LIST = Object.keys(EVENT_TYPE_SET) as EventType[];

export function isLane(value: unknown): value is Lane {
  return typeof value === "string" && Object.hasOwn(LANE_SET, value);
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && Object.hasOwn(EVENT_TYPE_SET, value);
}

/** Parse the data line of one SSE frame; null for anything that is not a valid event. */
export function parseEventData(text: string): BulletinEvent | null {
  try {
    return parseEvent(JSON.parse(text));
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Read a plan for display only, filling the same defaults as PlanSchema. Units without an id and
 * title are dropped; the server has already validated anything it sends.
 */
export function parsePlan(value: unknown): Plan | null {
  if (!isRecord(value) || !Array.isArray(value.units)) return null;
  const units: Unit[] = value.units.flatMap((u): Unit[] => {
    if (!isRecord(u) || typeof u.id !== "string" || typeof u.title !== "string") return [];
    const needs = Array.isArray(u.needs)
      ? u.needs.flatMap((n) => (isRecord(n) && typeof n.unit === "string" ? [{ unit: n.unit, reads: typeof n.reads === "string" ? n.reads : "" }] : []))
      : [];
    return [
      {
        id: u.id,
        title: u.title,
        task: typeof u.task === "string" ? u.task : "",
        files: strings(u.files),
        needs,
        lane: isLane(u.lane) ? u.lane : "open",
        tier: typeof u.tier === "string" ? u.tier : "station",
        acceptance: strings(u.acceptance),
      },
    ];
  });
  if (units.length === 0) return null;
  const version = typeof value.briefing_version === "number" ? value.briefing_version : 1;
  return { briefing_version: version, units };
}

/** Validate one SSE message the same way BulletinEventSchema does, filling the same defaults. */
export function parseEvent(value: unknown): BulletinEvent | null {
  if (!isRecord(value)) return null;
  const { id, mission_id, ts, type, unit_id, payload } = value;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0) return null;
  if (typeof mission_id !== "string" || mission_id.length === 0) return null;
  if (typeof ts !== "string" || !isEventType(type)) return null;
  if (unit_id !== undefined && unit_id !== null && typeof unit_id !== "string") return null;
  if (payload !== undefined && !isRecord(payload)) return null;
  return { id, mission_id, ts, type, unit_id: unit_id ?? null, payload: payload ?? {} };
}
