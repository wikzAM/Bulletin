import type { BulletinEvent, EventSink, EventType, PricesConfig } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import type { EventLog } from "../store/event-log";
import { capCheck, fareEstimate } from "../treasury/treasury";
import { missionExecution, type MissionExecution } from "./mission-execution";
import { readLedgerCharge, roundCents } from "./mission-ledger";
import { emptyBody, validateIdParams } from "./request-validation";

export type MissionStarter = (input: MissionExecution & {
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
  app.post<{ Params: { id: string } }>("/missions/:id/approve", { preValidation: validateIdParams }, async (request, reply) => {
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find((event) => event.type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    if (active.has(id) || events.some(({ type }) => type === "plan.approved" || type === "mission.finished")) {
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
      approved = await log.emit({ mission_id: id, type: "plan.approved" });
    } catch (error) {
      active.delete(id);
      throw error;
    } finally {
      planUpdates.delete(id);
    }
    const sink = runnerEventSink(log, id, [created, proposed, approved]);
    const signal = AbortSignal.any([controller.signal, shutdownSignal]);
    const run = Promise.resolve()
      .then(() => startMission({ ...execution, events: sink, signal }))
      .catch(async (error: unknown) => {
        request.log.error({ err: error }, "Mission execution failed");
        if (log.events.some((event) => event.mission_id === id && event.type === "mission.finished")) return;
        try {
          await log.emit({ mission_id: id, type: "mission.finished", payload: {
            status: "failed", error: "Mission execution failed",
          } });
        } catch (appendError) {
          request.log.error({ err: appendError }, "Could not record mission failure");
        }
      })
      .finally(() => {
        active.delete(id);
        running.delete(run);
      });
    running.add(run);

    return reply.code(202).send({ mission_id: id, status: "running" });
  });

  app.post<{ Params: { id: string } }>("/missions/:id/stop", { preValidation: validateIdParams }, async (request, reply) => {
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    if (!events.some(({ type }) => type === "mission.created")) return reply.code(404).send({ error: "Mission not found" });

    const controller = active.get(id);
    if (!controller || !events.some(({ type }) => type === "plan.approved") || events.some(({ type }) => type === "mission.finished")) {
      return reply.code(409).send({ error: "Mission is not running" });
    }

    controller.abort();
    return reply.code(202).send({ mission_id: id, status: "stopping" });
  });
}
