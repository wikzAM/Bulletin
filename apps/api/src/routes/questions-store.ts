import { randomUUID } from "node:crypto";

export interface NewQuestion {
  mission_id: string;
  unit_id: string | null;
  body: string;
}

export type Question = NewQuestion & {
  id: string;
  created_at: string;
} & (
  | { status: "open"; answer: null; answered_at: null }
  | { status: "answered"; answer: string; answered_at: string }
);

type AnswerResult =
  | { status: "missing" }
  | { status: "already_answered" }
  | { status: "answered"; question: Question };

export interface QuestionStore {
  list(missionId?: string): Promise<readonly Question[]>;
  create(input: NewQuestion): Promise<Question>;
  /** Implementations must check and set the answer in one operation. */
  answer(id: string, answer: string): Promise<AnswerResult>;
}

export class MemoryQuestionStore implements QuestionStore {
  private readonly questions = new Map<string, Question>();

  async list(missionId?: string): Promise<readonly Question[]> {
    return [...this.questions.values()].filter((question) => missionId === undefined || question.mission_id === missionId);
  }

  async create(input: NewQuestion): Promise<Question> {
    const question: Question = {
      ...input,
      id: randomUUID(),
      status: "open",
      created_at: new Date().toISOString(),
      answer: null,
      answered_at: null,
    };
    this.questions.set(question.id, question);
    return question;
  }

  async answer(id: string, answer: string): Promise<AnswerResult> {
    const question = this.questions.get(id);
    if (!question) return { status: "missing" };
    if (question.status === "answered") return { status: "already_answered" };

    const answered: Question = { ...question, status: "answered", answer, answered_at: new Date().toISOString() };
    this.questions.set(id, answered);
    return { status: "answered", question: answered };
  }
}
