import type { BulletinEvent } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EventLog } from "../store/event-log";
import { identifier, validateIdParams } from "./request-validation";

const decisionParams = z.object({ id: identifier, unit: identifier });
const decisionBody = z.strictObject({ choice: z.enum(["approve", "reject"]) });

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

export function registerMissionDecisions(app: FastifyInstance, log: EventLog): void {
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
    const events = log.events.filter((event) => event.mission_id === id);
    if (!events.some(({ type }) => type === "mission.created")) return reply.code(404).send({ error: "Mission not found" });
    const decision = openDecisions(events).find(({ unit_id, payload }) =>
      unit_id === unit && payload.kind !== "question" && payload.question_id === undefined,
    );
    if (!decision) return reply.code(404).send({ error: "Open decision not found" });
    if (resolving.has(decision.id)) return reply.code(409).send({ error: "Decision resolution in progress" });

    resolving.add(decision.id);
    try {
      const { kind } = decision.payload;
      return await log.emit({ mission_id: id, unit_id: unit, type: "decision.resolved", payload: {
        opened_event_id: decision.id, choice: body.data.choice, ...(typeof kind === "string" ? { kind } : {}),
      } });
    } finally {
      resolving.delete(decision.id);
    }
  });
}
