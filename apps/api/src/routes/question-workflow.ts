import { randomUUID } from "node:crypto";
import type { BulletinEvent } from "@bulletin/core";
import { z } from "zod";
import type { BulletinPipeline, BulletinStore, Dispatch, StationToolSet } from "../../../../packages/bulletin-mcp/src/index";
import type { ModelCall } from "../general";
import type { EventLog } from "../store/event-log";
import { answerFromBriefing } from "./answerer";
import type { AnswerResult, AnswerSource, NewQuestion, Question, QuestionStore } from "./questions-store";

const decisionSchema = z.object({ question_id: z.string(), question: z.string(), answer: z.string() });
const postedKind = z.enum(["progress", "blocker", "note"]);
type StationToolFactory = (attempt: { missionId: string; unit_id: string }) => StationToolSet;

export class QuestionWorkflow {
  private readonly changes = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, BulletinPipeline>();
  private stationFactory?: Promise<StationToolFactory>;

  constructor(private readonly log: EventLog, readonly store: QuestionStore) {}

  private async inMission<T>(missionId: string, change: () => Promise<T>): Promise<T> {
    const result = (this.changes.get(missionId) ?? Promise.resolve()).then(change, change);
    this.changes.set(missionId, result);
    try {
      return await result;
    } finally {
      if (this.changes.get(missionId) === result) this.changes.delete(missionId);
    }
  }

  private briefing(missionId: string) {
    return this.log.events.findLast(({ mission_id, type }) => mission_id === missionId && type === "briefing.versioned");
  }

  private async cachedAnswer(input: NewQuestion) {
    const stored = decisionSchema.safeParse(this.briefing(input.mission_id)?.payload.decision);
    if (!stored.success) return undefined;
    const { DECISIONS_HEADING, normalizeQuestion } = await import("../../../../packages/bulletin-mcp/src/index");
    if (normalizeQuestion(stored.data.question) !== normalizeQuestion(input.body)) return undefined;
    return { answer: stored.data.answer, source: "cache", briefing_ref: DECISIONS_HEADING } as const;
  }

  async post(input: NewQuestion): Promise<Question> {
    return this.inMission(input.mission_id, async () => {
      const question = await this.store.create(input);
      const { id: question_id, mission_id, unit_id, body } = question;
      await this.log.emit({ mission_id, unit_id, type: "dispatch.asked", payload: { question_id, body } });
      const cached = await this.cachedAnswer(input);
      if (cached) {
        const result = await this.saveAnswer(question, cached.answer, cached, false);
        if (result.status === "answered") return result.question;
        throw new Error("Could not record the cached answer");
      }
      await this.openDecision(question);
      return question;
    });
  }

  private async openDecision({ id: question_id, mission_id, unit_id }: Question) {
    await this.log.emit({ mission_id, unit_id, type: "decision.opened", payload: { question_id, kind: "question" } });
  }

  async answerHuman(id: string, answer: string): Promise<AnswerResult> {
    const found = await this.store.get(id);
    if (!found) return { status: "missing" };
    return this.inMission(found.mission_id, async () => {
      const question = await this.store.get(id);
      if (!question) return { status: "missing" };
      if (question.status === "answered") return { status: "already_answered" };
      const priorAnswer = this.answeredEvent(question);
      if (priorAnswer && priorAnswer.payload.answer !== answer) {
        return { status: "already_answered" };
      }
      if (!await this.appendDecision(question, answer)) return { status: "already_answered" };
      const result = await this.saveAnswer(question, answer, { source: "human" }, true);
      const waiting = this.pending.get(id);
      if (result.status === "answered" && waiting) {
        await waiting.resolve(id, answer);
        this.pending.delete(id);
      }
      return result;
    });
  }

  async answerAutomatically(question: Question, answer: string, source: AnswerSource): Promise<AnswerResult> {
    return this.inMission(question.mission_id, () => this.saveAnswer(question, answer, source, true));
  }

  private async appendDecision(question: Question, answer: string): Promise<boolean> {
    const { id: question_id, mission_id, body } = question;
    const current = this.briefing(mission_id)?.payload;
    if (!current || typeof current.markdown !== "string" || current.markdown.trim() === "") return true;
    const prior = this.log.events.findLast((event) => event.mission_id === mission_id && event.type === "briefing.versioned" &&
      decisionSchema.safeParse(event.payload.decision).data?.question_id === question_id);
    if (prior) return decisionSchema.parse(prior.payload.decision).answer === answer;

    const { appendDecisionLine } = await import("../../../../packages/bulletin-mcp/src/pipeline");
    const version = typeof current.version === "number" ? current.version : 1;
    await this.log.emit({ mission_id, type: "briefing.versioned", payload: {
      ...current,
      version: version + 1,
      markdown: appendDecisionLine(current.markdown, `- Q: ${body} A: ${answer}`),
      reason: "question_answer",
      decision: { question_id, question: body, answer },
    } });
    return true;
  }

  private questionEvent(question: Question, type: BulletinEvent["type"]) {
    return this.log.events.findLast((event) => event.mission_id === question.mission_id &&
      event.type === type && event.payload.question_id === question.id);
  }

  private answeredEvent(question: Question) {
    return this.questionEvent(question, "dispatch.answered");
  }

  private async saveAnswer(question: Question, answer: string, attribution: AnswerSource, resolvesDecision: boolean): Promise<AnswerResult> {
    const { id: question_id, mission_id, unit_id } = question;
    const current = await this.store.get(question_id);
    if (!current) return { status: "missing" };
    if (current.status === "answered") return { status: "already_answered" };
    const priorAnswer = this.answeredEvent(question);
    if (priorAnswer && priorAnswer.payload.answer !== answer) return { status: "already_answered" };
    const scope = { mission_id, unit_id };
    const { source } = attribution;
    const citation = source === "human" ? {} : attribution;
    if (!priorAnswer) {
      await this.log.emit({ ...scope, type: "dispatch.answered", payload: { question_id, answer, ...citation } });
    }
    if (resolvesDecision && !this.questionEvent(question, "decision.resolved")) {
      await this.log.emit({ ...scope, type: "decision.resolved", payload: {
        question_id, kind: "question", ...(source === "briefing" ? { source } : {}),
      } });
    }
    return this.store.answer(question_id, answer, attribution);
  }

  stationTools(call?: ModelCall): Promise<StationToolFactory> {
    this.stationFactory ??= import("../../../../packages/bulletin-mcp/src/index").then(({ BulletinPipeline, createStationTools }) => {
      const pipelines = new Map<string, BulletinPipeline>();
      return ({ missionId, unit_id }) => {
        let pipeline = pipelines.get(missionId);
        if (!pipeline) {
          const current = async () => {
            const briefing = this.briefing(missionId)?.payload;
            return {
              version: typeof briefing?.version === "number" ? briefing.version : 0,
              markdown: typeof briefing?.markdown === "string" ? briefing.markdown : "",
            };
          };
          const missionPipeline = new BulletinPipeline({
            // answerHuman commits the new Briefing and dispatch events before releasing the station.
            briefing: { current, appendDecision: current },
            rungs: call ? [async ({ question, briefing }) => briefing ? answerFromBriefing(call, briefing, question) : undefined] : [],
            onDecision: async ({ dispatch_id, question, unit_id }) => {
              const open = await this.store.create({ mission_id: missionId, unit_id, body: question }, dispatch_id);
              if (call) await this.store.markAutoAnswerTried(open.id);
              await this.openDecision(open);
              this.pending.set(dispatch_id, missionPipeline);
            },
          });
          pipelines.set(missionId, missionPipeline);
          pipeline = missionPipeline;
        }

        const missionPipeline = pipeline;
        return createStationTools({
          store: this.stationStore(missionId),
          answerer: {
            ask: (input) => this.inMission(missionId, async () => {
              const cached = await this.cachedAnswer({ mission_id: missionId, unit_id: input.unit_id, body: input.question });
              const result = cached ? { status: "answered" as const, ...cached } : await missionPipeline.ask(input);
              if (result.status === "answered") {
                const { answer, source, briefing_ref } = result;
                await this.log.emit({ mission_id: missionId, unit_id: input.unit_id, type: "dispatch.answered", payload: {
                  question_id: input.dispatch_id, answer, source, briefing_ref,
                } });
              }
              return result;
            }),
            wait: (input) => missionPipeline.wait(input),
          },
        }, unit_id);
      };
    });
    return this.stationFactory;
  }

  private stationStore(mission_id: string): BulletinStore {
    return {
      postDispatch: async ({ unit_id, kind, text }) => {
        const id = randomUUID();
        const event = await this.log.emit(kind === "question"
          ? { mission_id, unit_id, type: "dispatch.asked", payload: { question_id: id, body: text } }
          : { mission_id, unit_id, type: "dispatch.posted", payload: { dispatch_id: id, kind, text } });
        return { id, unit_id, kind, text, created_at: event.ts };
      },
      readDispatches: async ({ unit_id, since }) => this.log.events.flatMap((event) => {
        if (event.mission_id !== mission_id || (unit_id && event.unit_id !== unit_id) || (since && event.ts <= since)) return [];
        const dispatch = readDispatch(event);
        return dispatch ? [dispatch] : [];
      }),
      getBriefing: async (section) => {
        const markdown = this.briefing(mission_id)?.payload.markdown;
        if (typeof markdown !== "string") return null;
        if (section === undefined) return markdown;
        return markdown.split(/(?=^#{1,6}[ \t]+)/m).find((part) =>
          /^#{1,6}[ \t]+([^\r\n]+)/.exec(part)?.[1]?.trim().toLowerCase() === section.trim().toLowerCase(),
        ) ?? null;
      },
    };
  }
}

function readDispatch({ type, unit_id, ts, payload }: BulletinEvent): Dispatch | undefined {
  const scope = { unit_id: unit_id ?? undefined, created_at: ts };
  const { question_id, body, answer, dispatch_id, kind, text } = payload;
  if (type === "dispatch.asked" && typeof question_id === "string" && typeof body === "string") {
    return { ...scope, id: question_id, kind: "question", text: body };
  }
  if (type === "dispatch.answered" && typeof question_id === "string" && typeof answer === "string") {
    return { ...scope, id: question_id, kind: "answer", text: answer };
  }
  if (type === "dispatch.posted" && typeof dispatch_id === "string" && typeof text === "string") {
    const parsed = postedKind.safeParse(kind);
    if (parsed.success) return { ...scope, id: dispatch_id, kind: parsed.data, text };
  }
}
