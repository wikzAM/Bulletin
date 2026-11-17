import { z } from "zod";
import { JsonlFile } from "./jsonl-file";

export const maxInterviewQuestions = 10;
const briefingFields = {
  id: z.string().min(1),
  goal: z.string().min(1),
  answers: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1).nullable() })),
};
const briefingSchema = z.union([
  z.object({ ...briefingFields, answers: briefingFields.answers.max(maxInterviewQuestions - 1), question: z.string().min(1), markdown: z.null() }),
  z.object({ ...briefingFields, answers: briefingFields.answers.max(maxInterviewQuestions), question: z.null(), markdown: z.string().min(1) }),
]);

export type Briefing = z.infer<typeof briefingSchema>;

export interface BriefingStore {
  get(id: string): Briefing | undefined;
  save(briefing: Briefing): Promise<void>;
}

export class MemoryBriefingStore implements BriefingStore {
  private readonly briefings = new Map<string, Briefing>();

  get(id: string): Briefing | undefined {
    return this.briefings.get(id);
  }

  async save(briefing: Briefing): Promise<void> {
    this.briefings.set(briefing.id, briefing);
  }
}

export class JsonlBriefingStore implements BriefingStore {
  private constructor(private readonly file: JsonlFile<Briefing>) {}

  static async open(path: string): Promise<JsonlBriefingStore> {
    return new JsonlBriefingStore(await JsonlFile.open(path, "briefing", (value) => briefingSchema.parse(value)));
  }

  get(id: string): Briefing | undefined {
    return this.file.records.findLast((briefing) => briefing.id === id);
  }

  async save(briefing: Briefing): Promise<void> {
    await this.file.append(() => briefing);
  }

  close(): Promise<void> {
    return this.file.close();
  }
}
