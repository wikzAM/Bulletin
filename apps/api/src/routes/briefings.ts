import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModelCall } from "../general";
import { maxInterviewQuestions, type Briefing, type BriefingStore } from "../store/briefing-store";
import { INTERVIEWER_PROMPT } from "./interviewer-prompt";
import { requestModelJson } from "./model-output";
import { validateIdParams } from "./request-validation";

const nonBlankText = z.string().trim().min(1);
const goalBody = z.strictObject({ goal: nonBlankText });
const answerBody = z.strictObject({ question_number: z.number().int().min(1).max(maxInterviewQuestions), answer: nonBlankText.nullable() });

const requiredSections = ["Goal", "Users", "Features", "Constraints", "Out of scope", "Decisions log"];
const completeResponse = z.strictObject({ markdown: nonBlankText.refine((markdown) => {
  const lines = markdown.split(/\r?\n/);
  const sections = lines.filter((line) => line.startsWith("## "));
  return /^# Briefing: \S/.test(markdown) && requiredSections.every((heading, index) => sections[index] === `## ${heading}`);
}) });
const interviewResponse = z.union([z.strictObject({ question: nonBlankText }), completeResponse]);

function publicBriefing({ answers, question, markdown, ...briefing }: Briefing) {
  return {
    ...briefing,
    status: markdown === null ? "interview" : "complete",
    question,
    question_number: question === null ? null : answers.length + 1,
    version: markdown === null ? null : 1,
    markdown,
  };
}

async function interview(call: ModelCall, briefing: Pick<Briefing, "id" | "goal" | "answers">): Promise<Briefing | undefined> {
  const { id, goal, answers } = briefing;
  const questionsRemaining = maxInterviewQuestions - answers.length;
  const input = JSON.stringify({ goal, answers, questions_remaining: questionsRemaining });
  try {
    const next = await requestModelJson(call, INTERVIEWER_PROMPT.system, input, questionsRemaining > 0 ? interviewResponse : completeResponse);
    return "question" in next
      ? { id, goal, answers, question: next.question, markdown: null }
      : { id, goal, answers, question: null, markdown: next.markdown };
  } catch {
    return undefined;
  }
}

export function registerBriefings(app: FastifyInstance, store: BriefingStore, call?: ModelCall): void {
  const answering = new Set<string>();

  app.post("/briefings", async (request, reply) => {
    const body = goalBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    if (!call) return reply.code(503).send({ error: "Interviewer not configured" });

    const briefing = await interview(call, { id: randomUUID(), goal: body.data.goal, answers: [] });
    if (!briefing) return reply.code(502).send({ error: "Interviewer failed" });
    await store.save(briefing);
    return reply.code(201).send(publicBriefing(briefing));
  });

  app.get<{ Params: { id: string } }>("/briefings/:id", { preValidation: validateIdParams }, async (request, reply) => {
    const briefing = store.get(request.params.id);
    if (!briefing) return reply.code(404).send({ error: "Briefing not found" });
    return publicBriefing(briefing);
  });

  app.post<{ Params: { id: string } }>("/briefings/:id/answers", { preValidation: validateIdParams }, async (request, reply) => {
    const body = answerBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const { id } = request.params;
    const briefing = store.get(id);
    if (!briefing) return reply.code(404).send({ error: "Briefing not found" });
    if (briefing.question === null || body.data.question_number !== briefing.answers.length + 1 || answering.has(id)) {
      return reply.code(409).send({ error: "Briefing is not awaiting this answer" });
    }
    if (!call) return reply.code(503).send({ error: "Interviewer not configured" });

    answering.add(id);
    try {
      const answers = [...briefing.answers, { question: briefing.question, answer: body.data.answer }];
      const next = await interview(call, { ...briefing, answers });
      if (!next) return reply.code(502).send({ error: "Interviewer failed" });
      await store.save(next);
      return publicBriefing(next);
    } finally {
      answering.delete(id);
    }
  });
}
