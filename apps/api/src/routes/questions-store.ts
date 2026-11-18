import { randomUUID } from "node:crypto";

export interface NewQuestion {
  mission_id: string;
  unit_id: string | null;
  body: string;
}

export type AnswerSource = { source: "human" } | { source: "briefing" | "cache"; briefing_ref: string };

type StoredQuestion = NewQuestion & {
  id: string;
  created_at: string;
  auto_answer_tried?: true;
};

export type AnsweredQuestion = StoredQuestion & AnswerSource & { status: "answered"; answer: string; answered_at: string };
export type Question = AnsweredQuestion | (StoredQuestion & { status: "open"; answer: null; answered_at: null });

export type AnswerResult =
  | { status: "missing" }
  | { status: "already_answered" }
  | { status: "answered"; question: AnsweredQuestion };

export interface QuestionStore {
  list(missionId?: string): Promise<readonly Question[]>;
  get(id: string): Promise<Question | undefined>;
  create(input: NewQuestion, id?: string): Promise<Question>;
  /** Implementations must check and set the answer in one operation. */
  answer(id: string, answer: string, attribution?: AnswerSource): Promise<AnswerResult>;
  markAutoAnswerTried(id: string): Promise<Question | undefined>;
}

export class MemoryQuestionStore implements QuestionStore {
  private readonly questions = new Map<string, Question>();

  async list(missionId?: string): Promise<readonly Question[]> {
    return [...this.questions.values()].filter((question) => missionId === undefined || question.mission_id === missionId);
  }

  async get(id: string): Promise<Question | undefined> {
    return this.questions.get(id);
  }

  async create(input: NewQuestion, id = randomUUID()): Promise<Question> {
    const question: Question = {
      ...input,
      id,
      status: "open",
      created_at: new Date().toISOString(),
      answer: null,
      answered_at: null,
    };
    this.questions.set(question.id, question);
    return question;
  }

  async answer(id: string, answer: string, attribution: AnswerSource = { source: "human" }): Promise<AnswerResult> {
    const question = this.questions.get(id);
    if (!question) return { status: "missing" };
    if (question.status === "answered") return { status: "already_answered" };

    const answered: AnsweredQuestion = { ...question, ...attribution, status: "answered", answer, answered_at: new Date().toISOString() };
    this.questions.set(id, answered);
    return { status: "answered", question: answered };
  }

  async markAutoAnswerTried(id: string): Promise<Question | undefined> {
    const question = this.questions.get(id);
    if (question?.status !== "open") return question;
    const updated = { ...question, auto_answer_tried: true } as const;
    this.questions.set(id, updated);
    return updated;
  }
}
