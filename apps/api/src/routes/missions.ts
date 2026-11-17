import { LaneSchema, type BulletinEvent, type EventType, type Lane, type MemoryEventLog, type UnitStatus } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { registerMissionEventStream } from "./mission-events";

type MissionStatus = "interview" | "planning" | "running" | "finished";

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

function roundCents(cents: number): number {
  return Math.round(cents * 1e4) / 1e4;
}

const missionStatuses: Partial<Record<EventType, MissionStatus>> = {
  "briefing.versioned": "planning",
  "plan.proposed": "planning",
  "plan.approved": "running",
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
    const status = missionStatuses[type];
    if (mission && status) mission.status = status;
  }
  return [...missions.values()];
}

function missionProgress(events: readonly BulletinEvent[]) {
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

  for (const { type, unit_id, payload } of events) {
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

    if (type === "ledger.charged" && typeof payload.cost_cents === "number" && Number.isFinite(payload.cost_cents)) {
      ledger.cost_cents += payload.cost_cents;
      ledger.charges++;
      if (unit_id !== null) {
        const total = ledgerByUnit.get(unit_id) ?? { cost_cents: 0, charges: 0 };
        total.cost_cents += payload.cost_cents;
        total.charges++;
        ledgerByUnit.set(unit_id, total);
      }
    }
  }

  return { units: [...units.values()], ledger, ledgerByUnit };
}

export function registerMissionRoutes(app: FastifyInstance, log: MemoryEventLog): void {
  app.get("/missions", async () => ({ missions: listMissions(log.events) }));

  app.get<{ Params: { id: string } }>("/missions/:id", async (request, reply) => {
    const events = log.events.filter((event) => event.mission_id === request.params.id);
    const [mission] = listMissions(events);
    if (!mission) return reply.code(404).send({ error: "Mission not found" });
    const { units, ledger } = missionProgress(events);
    return { ...mission, units, ledger: { ...ledger, cost_cents: roundCents(ledger.cost_cents) } };
  });

  app.get<{ Params: { id: string } }>("/missions/:id/treasury", async (request, reply) => {
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find((event) => event.type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });

    const budget = created.payload.budget_cents;
    const budgetCents = typeof budget === "number" && Number.isSafeInteger(budget) && budget >= 0 ? budget : null;
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

  registerMissionEventStream(app, log);
}
