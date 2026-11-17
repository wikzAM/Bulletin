import { PlanSchema, type BulletinEvent, type EventSink, type EventType, type Plan, type PricesConfig } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EventLog } from "../store/event-log";
import { capCheck, fareEstimate } from "../treasury/treasury";
import { readLedgerCharge, readMissionBudget, roundCents } from "./mission-ledger";
import { emptyBody, validateIdParams } from "./request-validation";

export type MissionStarter = (input: {
  missionId: string;
  repo: string;
  baseBranch: string;
  briefing?: string;
  plan: Plan;
  events: EventSink;
}) => Promise<unknown>;

export interface MissionPricing {
  prices: PricesConfig;
  tiers: Readonly<Record<string, string>>;
}

const missionMetadata = z.object({
  repo: z.string().min(1),
  base: z.string().min(1),
  goal: z.string().optional(),
});

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
  startMission?: MissionStarter,
  pricing?: MissionPricing,
): void {
  const approvalsInFlight = new Set<string>();
  app.post<{ Params: { id: string } }>("/missions/:id/approve", { preValidation: validateIdParams }, async (request, reply) => {
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find((event) => event.type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    if (approvalsInFlight.has(id) || events.some(({ type }) => type === "plan.approved" || type === "mission.finished")) {
      return reply.code(409).send({ error: "Mission already approved" });
    }

    const proposed = events.findLast((event) => event.type === "plan.proposed");
    const metadata = missionMetadata.safeParse(created.payload);
    const plan = PlanSchema.safeParse(proposed?.payload.plan);
    if (!proposed || !metadata.success || !plan.success) {
      return reply.code(409).send({ error: "Mission has no plan to approve" });
    }

    const budgetCents = readMissionBudget(created.payload.budget_cents);
    if (budgetCents !== null) {
      if (!pricing) return reply.code(503).send({ error: "Mission pricing not configured" });
      let estimate: number;
      try {
        estimate = fareEstimate(plan.data.units, pricing.tiers, pricing.prices).lowCents;
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

    approvalsInFlight.add(id);
    let approved: BulletinEvent;
    try {
      approved = await log.emit({ mission_id: id, type: "plan.approved" });
    } finally {
      approvalsInFlight.delete(id);
    }
    const { repo, base, goal } = metadata.data;
    const markdown = events.findLast(({ type }) => type === "briefing.versioned")?.payload.markdown;
    const briefing = typeof markdown === "string" ? markdown : goal;
    const sink = runnerEventSink(log, id, [created, proposed, approved]);
    void Promise.resolve()
      .then(() => startMission({ missionId: id, repo, baseBranch: base, briefing, plan: plan.data, events: sink }))
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
      });

    return reply.code(202).send({ mission_id: id, status: "running" });
  });
}
