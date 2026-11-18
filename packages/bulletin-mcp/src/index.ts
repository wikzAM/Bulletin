import { z } from "zod";

/**
 * Bulletin MCP tool contracts (spec section 10). The server itself arrives with M2;
 * the input shapes are fixed here so stations, the answerer and tests agree on them.
 * A role's tool set never changes mid-run.
 */
export const BULLETIN_TOOLS = {
  bulletin_ask: z.object({
    unit_id: z.string().min(1),
    question: z.string().min(1),
    paths: z.array(z.string()).optional(),
  }),
  bulletin_wait: z.object({
    dispatch_id: z.string().min(1),
    timeout_s: z.number().int().positive().max(600),
  }),
  bulletin_post: z.object({
    unit_id: z.string().min(1),
    kind: z.enum(["progress", "blocker", "note"]),
    text: z.string().min(1),
  }),
  bulletin_read: z.object({
    unit_id: z.string().optional(),
    since: z.string().optional(),
  }),
  briefing_get: z.object({
    section: z.string().optional(),
  }),
} as const;

export type BulletinToolName = keyof typeof BULLETIN_TOOLS;

export const AskResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("answered"),
    answer: z.string(),
    source: z.enum(["cache", "briefing", "human"]),
    briefing_ref: z.string(),
  }),
  z.object({ status: z.literal("pending"), dispatch_id: z.string() }),
]);
export type AskResult = z.infer<typeof AskResultSchema>;

/** Step 1 of the answer pipeline: lowercase, trim, collapse whitespace. */
export function normalizeQuestion(question: string): string {
  return question.toLowerCase().trim().replace(/\s+/g, " ");
}

export * from "./server";
export * from "./pipeline";
