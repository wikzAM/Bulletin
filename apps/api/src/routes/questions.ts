import { ANSWERER_PROMPT } from "@bulletin/prompts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModelCall } from "../general";
import type { EventLog } from "../store/event-log";
import { answerFromBriefing } from "./answerer";
import type { QuestionWorkflow } from "./question-workflow";
import { emptyBody, identifier, validateIdParams } from "./request-validation";

const questionQuery = z.object({ mission_id: identifier.optional() });
const questionBody = z.strictObject({
  mission_id: identifier,
  unit_id: identifier.nullable().default(null),
  body: z.string().trim().min(1),
});
const answerBody = z.strictObject({ answer: z.string().trim().min(1) });

export function registerQuestionRoutes(
  app: FastifyInstance,
  log: EventLog,
  workflow: QuestionWorkflow,
  call?: ModelCall,
): void {
  const { store } = workflow;
  const answering = new Set<string>();
  app.get("/questions", async (request, reply) => {
    const parsed = questionQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    return { questions: await store.list(parsed.data.mission_id) };
  });

  app.post("/questions", async (request, reply) => {
    const parsed = questionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });

    const { mission_id } = parsed.data;
    if (!log.events.some((event) => event.mission_id === mission_id && event.type === "mission.created")) {
      return reply.code(404).send({ error: "Mission not found" });
    }
    const question = await workflow.post(parsed.data);
    return reply.code(201).send(question);
  });

  app.post<{ Params: { id: string } }>("/questions/:id/answer", { preValidation: validateIdParams }, async (request, reply) => {
    const parsed = answerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    const result = await workflow.answerHuman(request.params.id, parsed.data.answer);
    if (result.status === "missing") return reply.code(404).send({ error: "Question not found" });
    if (result.status === "already_answered") return reply.code(409).send({ error: "Question already answered" });

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
        const result = await workflow.answerAutomatically(question, answer.answer, { source: "briefing", briefing_ref: answer.briefing_ref });
        if (result.status === "missing") return reply.code(404).send({ error: "Question not found" });
        if (result.status === "already_answered") return reply.code(409).send({ error: "Question already answered" });
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
