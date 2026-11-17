import { PlanSchema, type BulletinEvent, type EventSink, type EventType, type MemoryEventLog, type Plan } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateIdParams } from "./request-validation";

export type MissionStarter = (input: {
  missionId: string;
  repo: string;
  baseBranch: string;
  briefing?: string;
  plan: Plan;
  events: EventSink;
}) => Promise<unknown>;

const missionMetadata = z.object({
  repo: z.string().min(1),
  base: z.string().min(1),
  goal: z.string().optional(),
});
const approvalBody = z.strictObject({}).optional();

function runnerEventSink(log: MemoryEventLog, missionId: string, startup: BulletinEvent[]): EventSink {
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

export function registerMissionApproval(app: FastifyInstance, log: MemoryEventLog, startMission?: MissionStarter): void {
  app.post<{ Params: { id: string } }>("/missions/:id/approve", { preValidation: validateIdParams }, async (request, reply) => {
    if (!approvalBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find((event) => event.type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    if (events.some(({ type }) => type === "plan.approved" || type === "mission.finished")) {
      return reply.code(409).send({ error: "Mission already approved" });
    }

    const proposed = events.findLast((event) => event.type === "plan.proposed");
    const metadata = missionMetadata.safeParse(created.payload);
    const plan = PlanSchema.safeParse(proposed?.payload.plan);
    if (!proposed || !metadata.success || !plan.success) {
      return reply.code(409).send({ error: "Mission has no plan to approve" });
    }
    if (!startMission) return reply.code(503).send({ error: "Mission runner not configured" });

    // MemoryEventLog appends synchronously before it returns its promise. A
    // concurrent approve request therefore sees this approval before starting.
    const approved = await log.emit({ mission_id: id, type: "plan.approved" });
    const { repo, base, goal } = metadata.data;
    const sink = runnerEventSink(log, id, [created, proposed, approved]);
    void Promise.resolve()
      .then(() => startMission({ missionId: id, repo, baseBranch: base, briefing: goal, plan: plan.data, events: sink }))
      .catch(async (error: unknown) => {
        request.log.error({ err: error }, "Mission execution failed");
        if (log.events.some((event) => event.mission_id === id && event.type === "mission.finished")) return;
        await log.emit({ mission_id: id, type: "mission.finished", payload: {
          status: "failed", error: "Mission execution failed",
        } });
      });

    return reply.code(202).send({ mission_id: id, status: "running" });
  });
}
