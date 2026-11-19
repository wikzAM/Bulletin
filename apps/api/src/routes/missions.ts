import { LaneSchema, type BulletinEvent, type EventType, type Lane, type UnitStatus } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EventLog } from "../store/event-log";
import { endsMissionExecution, isInterrupted, lastMissionExecution } from "../store/mission-state";
import type { MissionEventFeed } from "./mission-event-feed";
import { registerMissionEventStream } from "./mission-events";
import { missionLimits, readLedgerCharge, roundCents } from "./mission-ledger";
import { renderMissionReceipt } from "./mission-receipt";
import { validateIdParams } from "./request-validation";

const missionStatus = z.enum(["interview", "planning", "running", "finished", "failed", "interrupted", "paused"]);
type MissionStatus = z.infer<typeof missionStatus>;

const missionListQuery = z.object({
  status: missionStatus.optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative()).optional(),
});

interface MissionSummary {
  id: string;
  repo: string | null;
  base: string | null;
  created_at: string;
  status: MissionStatus;
}

interface MissionUnit {
  id: string;
  status: UnitStatus;
  lane: Lane | null;
  wave: number | null;
}

interface LedgerTotal {
  cost_cents: number;
  charges: number;
}

const missionStatuses: Partial<Record<EventType, MissionStatus>> = {
  "briefing.versioned": "planning",
  "plan.proposed": "planning",
  "plan.approved": "running",
  "mission.resumed": "running",
  "wave.started": "running",
  "mission.interrupted": "interrupted",
  "mission.finished": "finished",
};

const unitStatuses: Partial<Record<EventType, UnitStatus>> = {
  "unit.started": "running",
  "attempt.started": "running",
  "pass.green": "green",
  "pass.red": "red",
  "unit.sent_back": "red",
  "unit.held": "held",
  "unit.merged": "merged",
  "unit.failed": "failed",
  "unit.blocked": "blocked",
};

function listMissions(events: readonly BulletinEvent[]): MissionSummary[] {
  const missions = new Map<string, MissionSummary>();
  for (const { mission_id, ts, type, payload } of events) {
    const mission = missions.get(mission_id);
    if (!mission && type === "mission.created") {
      missions.set(mission_id, {
        id: mission_id,
        repo: typeof payload.repo === "string" ? payload.repo : null,
        base: typeof payload.base === "string" ? payload.base : null,
        created_at: ts,
        status: "interview",
      });
    }
    if (type === "briefing.versioned" && payload.reason === "question_answer") continue;
    const status = missionStatuses[type];
    if (mission && status) {
      mission.status = status;
      if (type === "mission.finished" && payload.status === "failed") mission.status = "failed";
      if (type === "mission.finished" && payload.paused === true) mission.status = "paused";
      if (type === "mission.finished" && payload.interrupted === true) mission.status = "interrupted";
    }
  }
  return [...missions.values()];
}

export function missionProgress(events: readonly BulletinEvent[]) {
  const units = new Map<string, MissionUnit>();
  const ledgerByUnit = new Map<string, LedgerTotal>();
  const ledger = { cost_cents: 0, charges: 0 };

  function getUnit(id: string): MissionUnit {
    const existing = units.get(id);
    if (existing) return existing;
    const unit: MissionUnit = { id, status: "pending", lane: null, wave: null };
    units.set(id, unit);
    return unit;
  }

  for (const event of events) {
    const { type, unit_id, payload } = event;
    if (type === "wave.started" && Array.isArray(payload.units)) {
      for (const id of payload.units) {
        if (typeof id !== "string") continue;
        const unit = getUnit(id);
        if (typeof payload.wave === "number" && Number.isSafeInteger(payload.wave) && payload.wave > 0) {
          unit.wave = payload.wave;
        }
      }
    }

    if (unit_id !== null) {
      const unit = getUnit(unit_id);
      const status = unitStatuses[type];
      if (status) unit.status = status;
      if (type === "unit.started" || type === "unit.held") {
        const lane = LaneSchema.safeParse(payload.lane);
        if (lane.success) unit.lane = lane.data;
      }
    }

    const cost = readLedgerCharge(event);
    if (cost !== undefined) {
      ledger.cost_cents += cost;
      ledger.charges++;
      if (unit_id !== null) {
        const total = ledgerByUnit.get(unit_id) ?? { cost_cents: 0, charges: 0 };
        total.cost_cents += cost;
        total.charges++;
        ledgerByUnit.set(unit_id, total);
      }
    }
  }

  return { units: [...units.values()], ledger, ledgerByUnit };
}

function automaticAnswer(source: unknown): boolean {
  return source === "briefing" || source === "cache";
}

function questionKey({ question_id, dispatch_id }: BulletinEvent["payload"]): string | undefined {
  if (typeof question_id === "string" && question_id) return question_id;
  if (typeof dispatch_id === "string" && dispatch_id) return dispatch_id;
}

function reportActivity(history: readonly BulletinEvent[]) {
  const questions = new Set<string>();
  const automated = new Set<string>();
  let unkeyedQuestions = 0;
  let touches = 0;
  let hasDecisionHistory = false;
  let proposed = false;
  let briefed = false;

  for (const { type, payload } of history) {
    if (type === "briefing.versioned") {
      if (briefed && payload.reason !== "question_answer") touches++;
      briefed = true;
    } else if (type === "plan.proposed") {
      if (proposed) touches++;
      proposed = true;
    } else if (type === "decision.opened" || type === "decision.resolved") {
      hasDecisionHistory = true;
      if (type === "decision.resolved" && !automaticAnswer(payload.source)) touches++;
    } else if (type === "dispatch.asked") {
      const key = questionKey(payload);
      if (key) questions.add(key);
      else unkeyedQuestions++;
    } else if (type === "dispatch.answered") {
      const key = questionKey(payload);
      if (key && questions.has(key)) {
        if (automaticAnswer(payload.source)) automated.add(key);
        else automated.delete(key);
      }
    }
  }

  const totalQuestions = questions.size + unkeyedQuestions;
  return { touches, hasDecisionHistory, autoAnswerRate: totalQuestions ? automated.size / totalQuestions : null };
}

function finishedReport(events: readonly BulletinEvent[], created: BulletinEvent, finished: BulletinEvent) {
  const history = events.filter(({ id }) => id <= finished.id);
  const { units, ledger } = missionProgress(history);
  const unitsWith = (status: UnitStatus) => units.filter((unit) => unit.status === status).map(({ id }) => id);
  const shipped = unitsWith("merged");
  const held = unitsWith("held");
  const green = new Set<string>();
  const sentBack: Array<{ unit_id: string; reason: string | null }> = [];
  let repeatReturns = 0;
  let attempts = 0;
  for (const { unit_id, type, payload } of history) {
    if (type === "attempt.ended") attempts++;
    if (unit_id === null) continue;
    if (type === "pass.green") green.add(unit_id);
    if (type === "pass.red" || type === "unit.sent_back") green.delete(unit_id);
    if (type === "unit.sent_back") {
      const reason = typeof payload.reason === "string" ? payload.reason : null;
      sentBack.push({ unit_id, reason });
      if (reason !== null && payload.repeat_return === true) repeatReturns++;
    }
  }

  const cost = roundCents(ledger.cost_cents);
  const activity = reportActivity(history);
  const recordedTouches = finished.payload.touches;
  const legacyTouches = typeof recordedTouches === "number" && Number.isSafeInteger(recordedTouches) && recordedTouches >= 0
    ? recordedTouches : held.length;
  const touches = activity.hasDecisionHistory || activity.touches > 0 ? activity.touches : legacyTouches;
  const started = history.find(({ type }) => type === "plan.approved") ?? created;
  const elapsed = Date.parse(finished.ts) - Date.parse(started.ts);

  return {
    mission_id: created.mission_id,
    shipped,
    held,
    failed: unitsWith("failed"),
    blocked: unitsWith("blocked"),
    attempts,
    repeat_returns: repeatReturns,
    sent_back: sentBack,
    model_calls: ledger.charges,
    cost_cents: cost,
    cost_per_green_unit_cents: green.size ? roundCents(cost / green.size) : null,
    touches,
    touch_rate: shipped.length ? touches / shipped.length : null,
    auto_answer_rate: activity.autoAnswerRate,
    elapsed_ms: Number.isFinite(elapsed) ? Math.max(0, elapsed) : null,
  };
}

export function registerMissionRoutes(app: FastifyInstance, log: EventLog, feed?: MissionEventFeed): void {
  app.get("/missions", async (request, reply) => {
    const filters = missionListQuery.safeParse(request.query);
    if (!filters.success) return reply.code(400).send({ error: "Invalid request" });
    const { status, limit } = filters.data;
    const missions = listMissions(log.events).filter((mission) => status === undefined || mission.status === status);
    return { missions: missions.slice(0, limit) };
  });

  app.get<{ Params: { id: string } }>("/missions/:id", { preValidation: validateIdParams }, async (request, reply) => {
    const events = log.events.filter((event) => event.mission_id === request.params.id);
    const [mission] = listMissions(events);
    if (!mission) return reply.code(404).send({ error: "Mission not found" });
    const { units, ledger } = missionProgress(events);
    return { ...mission, units, ledger: { ...ledger, cost_cents: roundCents(ledger.cost_cents) } };
  });

  app.get<{ Params: { id: string } }>("/missions/:id/treasury", { preValidation: validateIdParams }, async (request, reply) => {
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find((event) => event.type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });

    const { budgetCents } = missionLimits(created, events);
    const { units, ledger, ledgerByUnit } = missionProgress(events);
    return {
      mission_id: id,
      budget_cents: budgetCents,
      cost_cents: roundCents(ledger.cost_cents),
      remaining_cents: budgetCents === null ? null : roundCents(budgetCents - ledger.cost_cents),
      charges: ledger.charges,
      units: units.map(({ id: unitId }) => {
        const total = ledgerByUnit.get(unitId);
        return { id: unitId, cost_cents: roundCents(total?.cost_cents ?? 0), charges: total?.charges ?? 0 };
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/missions/:id/report", { preValidation: validateIdParams }, async (request, reply) => {
    const events = log.events.filter((event) => event.mission_id === request.params.id);
    const created = events.find(({ type }) => type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    const finished = lastMissionExecution(events);
    if (!finished || !endsMissionExecution(finished)) return reply.code(409).send({ error: "Mission has not finished" });
    return finishedReport(events, created, finished);
  });

  app.get<{ Params: { id: string } }>("/missions/:id/receipt.md", { preValidation: validateIdParams }, async (request, reply) => {
    const events = log.events.filter((event) => event.mission_id === request.params.id);
    const created = events.find(({ type }) => type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    const finished = lastMissionExecution(events);
    if (finished?.type !== "mission.finished" || isInterrupted(finished)) {
      return reply.code(409).send({ error: "Mission has not finished" });
    }

    const history = events.filter(({ id }) => id <= finished.id);
    const receipt = renderMissionReceipt(finishedReport(history, created, finished), history);
    return reply
      .type("text/markdown; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="receipt.md"')
      .send(receipt);
  });

  registerMissionEventStream(app, log, feed);
}
