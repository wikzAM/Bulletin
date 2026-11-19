import type { BulletinEvent, EventSink, EventType, PricesConfig } from "@bulletin/core";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { MissionOptions } from "../orchestrator/run-mission";
import type { EventLog } from "../store/event-log";
import { endsMissionExecution, isInterrupted, lastMissionExecution } from "../store/mission-state";
import { capCheck, fareEstimate } from "../treasury/treasury";
import { missionExecution, type MissionExecution } from "./mission-execution";
import { readLedgerCharge, roundCents } from "./mission-ledger";
import { missionProgress } from "./missions";
import { emptyBody, validateIdParams } from "./request-validation";

type MissionRun = MissionExecution & { resume?: MissionOptions["resume"] };

export type MissionStarter = (input: MissionRun & {
  events: EventSink;
  signal: AbortSignal;
}) => Promise<unknown>;

export interface MissionPricing {
  prices: PricesConfig;
  tiers: Readonly<Record<string, string>>;
}

function runnerEventSink(log: EventLog, missionId: string, startup: BulletinEvent[]): EventSink {
  // Standalone engine runs publish their own startup events. The API already
  // recorded these for plan review, so reuse them when that engine starts.
  const published = new Map<EventType, BulletinEvent>(startup.map((event) => [event.type, event]));
  return {
    async emit(event) {
      const existing = event.mission_id === missionId ? published.get(event.type) : undefined;
      return existing ?? log.emit(event);
    },
  };
}

export function registerMissionApproval(
  app: FastifyInstance,
  log: EventLog,
  planUpdates: Set<string>,
  shutdownSignal: AbortSignal,
  startMission?: MissionStarter,
  pricing?: MissionPricing,
): void {
  const active = new Map<string, AbortController>();
  const running = new Set<Promise<unknown>>();
  app.addHook("preClose", async () => { await Promise.all(running); });

  function launch(start: MissionStarter, execution: MissionRun, controller: AbortController, sink: EventSink, logger: FastifyBaseLogger) {
    const id = execution.missionId;
    const signal = AbortSignal.any([controller.signal, shutdownSignal]);
    const run = Promise.resolve()
      .then(() => start({ ...execution, events: sink, signal }))
      .catch(async (error: unknown) => {
        logger.error({ err: error }, "Mission execution failed");
        const last = lastMissionExecution(log.events.filter((event) => event.mission_id === id));
        if (last && endsMissionExecution(last)) return;
        try {
          await log.emit({ mission_id: id, type: "mission.finished", payload: {
            status: "failed", error: "Mission execution failed",
          } });
        } catch (appendError) {
          logger.error({ err: appendError }, "Could not record mission failure");
        }
      })
      .finally(() => {
        active.delete(id);
        running.delete(run);
      });
    running.add(run);
  }

  app.post<{ Params: { id: string } }>("/missions/:id/approve", { preValidation: validateIdParams }, async (request, reply) => {
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find((event) => event.type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    if (active.has(id) || events.some((event) =>
      event.type === "plan.approved" || (event.type === "mission.finished" && !isInterrupted(event))
    )) {
      return reply.code(409).send({ error: "Mission already approved" });
    }

    if (planUpdates.has(id)) return reply.code(409).send({ error: "Mission plan update in progress" });

    const proposed = events.findLast((event) => event.type === "plan.proposed");
    const execution = missionExecution(created, proposed, events);
    if (!proposed || !execution) {
      return reply.code(409).send({ error: "Mission has no plan to approve" });
    }

    const { budgetCents } = execution;
    if (budgetCents !== undefined) {
      if (!pricing) return reply.code(503).send({ error: "Mission pricing not configured" });
      let estimate: number;
      try {
        estimate = fareEstimate(execution.plan.units, pricing.tiers, pricing.prices).lowCents;
      } catch {
        return reply.code(422).send({ error: "Plan cannot be priced" });
      }
      const spentCents = roundCents(events.reduce((sum, event) => sum + (readLedgerCharge(event) ?? 0), 0));
      const cap = capCheck({ budgetCents, spentCents, reservedCents: 0, nextEstimateCents: estimate });
      if (!cap.ok) {
        return reply.code(409).send({
          error: "Plan exceeds mission budget", budget_cents: budgetCents, estimated_cents: estimate,
          spent_cents: spentCents, shortfall_cents: roundCents(cap.shortfallCents),
        });
      }
    }
    if (!startMission) return reply.code(503).send({ error: "Mission runner not configured" });

    const controller = new AbortController();
    active.set(id, controller);
    planUpdates.add(id);
    let approved: BulletinEvent;
    try {
      approved = await log.emit({ mission_id: id, type: "plan.approved", payload: { owner_pid: process.pid } });
    } catch (error) {
      active.delete(id);
      throw error;
    } finally {
      planUpdates.delete(id);
    }
    const sink = runnerEventSink(log, id, [created, proposed, approved]);
    launch(startMission, execution, controller, sink, request.log);

    return reply.code(202).send({ mission_id: id, status: "running" });
  });

  app.post<{ Params: { id: string } }>("/missions/:id/resume", { preValidation: validateIdParams }, async (request, reply) => {
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find(({ type }) => type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    if (active.has(id) || !isInterrupted(lastMissionExecution(events))) {
      return reply.code(409).send({ error: "Mission is not interrupted" });
    }

    const approved = events.findLast(({ type }) => type === "plan.approved");
    const proposed = events.findLast(({ type }) => type === "plan.proposed");
    const execution = missionExecution(created, proposed, events);
    if (!approved || !execution) return reply.code(409).send({ error: "Mission has no approved plan to resume" });
    if (!startMission) return reply.code(503).send({ error: "Mission runner not configured" });

    const { units, ledger } = missionProgress(events);
    const statuses = Object.fromEntries(units
      .filter(({ status }) => status === "merged" || status === "held")
      .map(({ id, status }) => [id, status]));
    const priorAttempts = new Map<string, number>();
    let wave = 0;
    for (const { type, unit_id, payload } of events) {
      if (type === "wave.started") wave++;
      if (type !== "attempt.started" || unit_id === null) continue;
      const attempt = payload.attempt;
      if (typeof attempt === "number" && Number.isSafeInteger(attempt) && attempt > (priorAttempts.get(unit_id) ?? 0)) {
        priorAttempts.set(unit_id, attempt);
      }
    }

    const controller = new AbortController();
    active.set(id, controller);
    try {
      await log.emit({ mission_id: id, type: "mission.resumed", payload: { owner_pid: process.pid } });
    } catch (error) {
      active.delete(id);
      throw error;
    }
    launch(startMission, {
      ...execution,
      resume: { statuses, spentCents: roundCents(ledger.cost_cents), wave, priorAttempts },
    }, controller, log, request.log);
    return reply.code(202).send({ mission_id: id, status: "running" });
  });

  app.post<{ Params: { id: string } }>("/missions/:id/stop", { preValidation: validateIdParams }, async (request, reply) => {
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    if (!events.some(({ type }) => type === "mission.created")) return reply.code(404).send({ error: "Mission not found" });

    const controller = active.get(id);
    const last = lastMissionExecution(events);
    if (!controller || !last || endsMissionExecution(last)) {
      return reply.code(409).send({ error: "Mission is not running" });
    }

    controller.abort();
    return reply.code(202).send({ mission_id: id, status: "stopping" });
  });
}
