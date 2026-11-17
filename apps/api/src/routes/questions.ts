import type { MemoryEventLog } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MemoryQuestionStore, type QuestionStore } from "./questions-store";
import { identifier, validateIdParams } from "./request-validation";

const questionQuery = z.object({ mission_id: identifier.optional() });
const questionBody = z.strictObject({
  mission_id: identifier,
  unit_id: identifier.nullable().default(null),
  body: z.string().trim().min(1),
});
const answerBody = z.strictObject({ answer: z.string().trim().min(1) });

export function registerQuestionRoutes(
  app: FastifyInstance,
  log: MemoryEventLog,
  store: QuestionStore = new MemoryQuestionStore(),
): void {
  app.get("/questions", async (request, reply) => {
    const parsed = questionQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    return { questions: await store.list(parsed.data.mission_id) };
  });

  app.post("/questions", async (request, reply) => {
    const parsed = questionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });

    const { mission_id, unit_id, body } = parsed.data;
    if (!log.events.some((event) => event.mission_id === mission_id && event.type === "mission.created")) {
      return reply.code(404).send({ error: "Mission not found" });
    }
    const question = await store.create(parsed.data);
    const scope = { mission_id, unit_id };
    await log.emit({ ...scope, type: "dispatch.asked", payload: { question_id: question.id, body } });
    await log.emit({ ...scope, type: "decision.opened", payload: { question_id: question.id, kind: "question" } });
    return reply.code(201).send(question);
  });

  app.post<{ Params: { id: string } }>("/questions/:id/answer", { preValidation: validateIdParams }, async (request, reply) => {
    const parsed = answerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    const result = await store.answer(request.params.id, parsed.data.answer);
    if (result.status === "missing") return reply.code(404).send({ error: "Question not found" });
    if (result.status === "already_answered") return reply.code(409).send({ error: "Question already answered" });

    const { question } = result;
    const scope = { mission_id: question.mission_id, unit_id: question.unit_id };
    await log.emit({ ...scope, type: "dispatch.answered", payload: { question_id: question.id, answer: question.answer } });
    await log.emit({ ...scope, type: "decision.resolved", payload: { question_id: question.id, kind: "question" } });
    return question;
  });
}
