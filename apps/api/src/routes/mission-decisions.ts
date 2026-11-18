import type { BulletinEvent, EventSink } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HeldResolution, ResolveHeldResult } from "../orchestrator/resolve-held";
import type { EventLog } from "../store/event-log";
import { missionExecution, type MissionExecution } from "./mission-execution";
import { identifier, validateIdParams } from "./request-validation";

const decisionParams = z.object({ id: identifier, unit: identifier });
const decisionBody = z.strictObject({ choice: z.enum(["approve", "reject"]) });

export type HeldMissionResolver = (input: MissionExecution & {
  unitId: string;
  resolution: HeldResolution;
  history: readonly BulletinEvent[];
  events: EventSink;
}) => Promise<ResolveHeldResult["outcome"]>;

const resolutionErrors = {
  conflict: "Held branch conflicts with the integration branch",
  not_held: "Unit is no longer held",
  mission_running: "Mission is still running",
};

function matchesResolution(opened: BulletinEvent, resolved: BulletinEvent): boolean {
  if (opened.unit_id !== resolved.unit_id) return false;
  const { opened_event_id, decision_id, question_id, kind } = resolved.payload;
  if (typeof opened_event_id === "number") return opened.id === opened_event_id;
  if (typeof decision_id === "string" || typeof decision_id === "number") return opened.payload.decision_id === decision_id;
  if (typeof question_id === "string") return opened.payload.question_id === question_id;
  if (opened.payload.decision_id !== undefined || opened.payload.question_id !== undefined) return false;
  return typeof kind === "string" ? opened.payload.kind === kind : opened.payload.kind !== "question";
}

function openDecisions(events: readonly BulletinEvent[]): BulletinEvent[] {
  const pending: BulletinEvent[] = [];
  for (const event of events) {
    if (event.type === "decision.opened") pending.push(event);
    if (event.type === "decision.resolved") {
      const index = pending.findLastIndex((opened) => matchesResolution(opened, event));
      if (index >= 0) pending.splice(index, 1);
    }
  }
  return pending;
}

function appliedHoldChoice(events: readonly BulletinEvent[], decision: BulletinEvent): HeldResolution | undefined {
  const effect = events.findLast(({ id, unit_id, type, payload }) => id > decision.id && unit_id === decision.unit_id && (
    (type === "unit.merged" && payload.approved === true) || (type === "unit.failed" && payload.reason === "rejected")
  ));
  if (effect) return effect.type === "unit.merged" ? "approve" : "reject";
}

export function registerMissionDecisions(app: FastifyInstance, log: EventLog, resolveHeldMission?: HeldMissionResolver): void {
  const resolving = new Set<number>();

  app.get<{ Params: { id: string } }>("/missions/:id/decisions", { preValidation: validateIdParams }, async (request, reply) => {
    const events = log.events.filter((event) => event.mission_id === request.params.id);
    if (!events.some(({ type }) => type === "mission.created")) return reply.code(404).send({ error: "Mission not found" });
    return { decisions: openDecisions(events) };
  });

  app.post("/missions/:id/decisions/:unit/resolve", async (request, reply) => {
    const params = decisionParams.safeParse(request.params);
    const body = decisionBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid request" });

    const { id, unit } = params.data;
    const { choice } = body.data;
    const events = log.events.filter((event) => event.mission_id === id);
    const created = events.find(({ type }) => type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });
    const decision = openDecisions(events).find(({ unit_id, payload }) =>
      unit_id === unit && payload.kind !== "question" && payload.question_id === undefined,
    );
    if (!decision) return reply.code(404).send({ error: "Open decision not found" });
    if (resolving.has(decision.id)) return reply.code(409).send({ error: "Decision resolution in progress" });

    resolving.add(decision.id);
    try {
      const { kind } = decision.payload;
      if (resolveHeldMission && (kind === "closed_lane_merge" || kind === "gated_retry")) {
        const applied = appliedHoldChoice(events, decision);
        if (applied && applied !== choice) return reply.code(409).send({ error: "Held unit already resolved with a different choice" });
        if (!applied) {
          const proposed = events.findLast(({ type }) => type === "plan.proposed");
          const execution = missionExecution(created, proposed, events);
          if (!execution) return reply.code(409).send({ error: "Mission has no plan for held work" });
          const outcome = await resolveHeldMission({
            ...execution, unitId: unit, resolution: choice, history: log.events, events: log,
          });
          if (outcome !== "merged" && outcome !== "rejected") {
            return reply.code(409).send({ error: resolutionErrors[outcome] });
          }
        }
      }
      return await log.emit({ mission_id: id, unit_id: unit, type: "decision.resolved", payload: {
        opened_event_id: decision.id, choice, ...(typeof kind === "string" ? { kind } : {}),
      } });
    } finally {
      resolving.delete(decision.id);
    }
  });
}
