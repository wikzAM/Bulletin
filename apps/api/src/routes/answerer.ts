import { ANSWERER_PROMPT, quoteDispatch } from "@bulletin/prompts";
import { z } from "zod";
import type { ModelCall } from "../general";
import { requestModelJson } from "./model-output";

const answerShape = z.strictObject({ answer: z.string().trim().min(1), briefing_ref: z.string().trim().optional() });

export async function answerFromBriefing(call: ModelCall, markdown: string, question: string) {
  const user = `BRIEFING\n${markdown}\n\nQUESTION\n${quoteDispatch(question)}`;
  const acceptSilent: ModelCall = async (system, input) => {
    const raw = await call(system, input);
    return raw.trim() === "SILENT" ? '{"answer":"SILENT"}' : raw;
  };
  const result = await requestModelJson(acceptSilent, ANSWERER_PROMPT.system, user, answerShape);
  if (result.answer === "SILENT" || !result.briefing_ref) return undefined;

  const ref = result.briefing_ref.replace(/^#{1,6}\s+/, "").toLowerCase();
  const headings = [...markdown.matchAll(/^#{1,6}[ \t]+([^\r\n]+)$/gm)].map((match) => match[1]?.trim());
  const heading = headings.find((candidate) => candidate?.toLowerCase() === ref);
  return heading ? { answer: result.answer, briefing_ref: heading } : undefined;
}
