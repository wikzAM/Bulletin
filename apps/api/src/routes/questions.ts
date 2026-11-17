import { ANSWERER_PROMPT } from "@bulletin/prompts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModelCall } from "../general";
import type { EventLog } from "../store/event-log";
import { answerFromBriefing } from "./answerer";
import { MemoryQuestionStore, type AnsweredQuestion, type QuestionStore } from "./questions-store";
import { emptyBody, identifier, validateIdParams } from "./request-validation";

const questionQuery = z.object({ mission_id: identifier.optional() });
const questionBody = z.strictObject({
  mission_id: identifier,
  unit_id: identifier.nullable().default(null),
  body: z.string().trim().min(1),
});
const answerBody = z.strictObject({ answer: z.string().trim().min(1) });

async function publishAnswer(log: EventLog, question: AnsweredQuestion): Promise<void> {
  const { mission_id, unit_id, id: question_id, answer, source } = question;
  const citation = source === "briefing" ? { source, briefing_ref: question.briefing_ref } : {};
  await log.emit({ mission_id, unit_id, type: "dispatch.answered", payload: { question_id, answer, ...citation } });
  await log.emit({ mission_id, unit_id, type: "decision.resolved", payload: {
    question_id, kind: "question", ...(source === "briefing" ? { source } : {}),
  } });
}

export function registerQuestionRoutes(
  app: FastifyInstance,
  log: EventLog,
  store: QuestionStore = new MemoryQuestionStore(),
  call?: ModelCall,
): void {
  const answering = new Set<string>();
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

    await publishAnswer(log, result.question);
    return result.question;
  });

  app.post<{ Params: { id: string } }>("/questions/:id/auto-answer", { preValidation: validateIdParams }, async (request, reply) => {
    if (!emptyBody.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    if (answering.has(id)) return reply.code(409).send({ error: "Auto-answer already in progress" });
    answering.add(id);

    try {
      const question = await store.get(id);
      if (!question) return reply.code(404).send({ error: "Question not found" });
      if (question.status === "answered") return reply.code(409).send({ error: "Question already answered" });
      const { mission_id, unit_id, body } = question;
      const markdown = log.events.findLast((event) => event.mission_id === mission_id && event.type === "briefing.versioned")?.payload.markdown;
      if (typeof markdown !== "string" || markdown.trim() === "") {
        return reply.code(409).send({ error: "Mission has no completed Briefing" });
      }
      if (!call) return reply.code(503).send({ error: "Answerer not configured" });

      let answer;
      try {
        answer = await answerFromBriefing(call, markdown, body);
      } catch {
        return reply.code(502).send({ error: "Answerer failed" });
      }

      if (answer) {
        const result = await store.answer(id, answer.answer, { source: "briefing", briefing_ref: answer.briefing_ref });
        if (result.status === "missing") return reply.code(404).send({ error: "Question not found" });
        if (result.status === "already_answered") return reply.code(409).send({ error: "Question already answered" });
        await publishAnswer(log, result.question);
        return result.question;
      }

      const open = await store.markAutoAnswerTried(id);
      if (!open) return reply.code(404).send({ error: "Question not found" });
      if (open.status === "answered") return reply.code(409).send({ error: "Question already answered" });
      await log.emit({ mission_id, unit_id, type: "dispatch.escalated", payload: {
        question_id: id, outcome: "silent", prompt_version: ANSWERER_PROMPT.version,
      } });
      return open;
    } finally {
      answering.delete(id);
    }
  });
}
