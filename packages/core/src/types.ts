import { z } from "zod";

/** Merge policy by blast radius. Ordered from least to most strict. */
export const LANES = ["open", "gated", "closed"] as const;
export const LaneSchema = z.enum(LANES);
export type Lane = z.infer<typeof LaneSchema>;

export const UNIT_STATUSES = [
  "pending",
  "running",
  "green",
  "red",
  "held",
  "merged",
  "failed",
  "blocked",
] as const;
export const UnitStatusSchema = z.enum(UNIT_STATUSES);
export type UnitStatus = z.infer<typeof UnitStatusSchema>;

/** "Unit B needs unit A" - valid only if it names what B reads from A. */
export const NeedSchema = z.object({
  unit: z.string().min(1),
  reads: z.string(),
});
export type Need = z.infer<typeof NeedSchema>;

export const TokenEstimateSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export type TokenEstimate = z.infer<typeof TokenEstimateSchema>;

/** One job a program can check: a task, the files it owns, and its acceptance checks. */
export const UnitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  task: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  needs: z.array(NeedSchema).default([]),
  lane: LaneSchema.default("open"),
  tier: z.string().min(1).default("station"),
  acceptance: z.array(z.string().min(1)).default([]),
  estimate: TokenEstimateSchema.optional(),
});
export type Unit = z.infer<typeof UnitSchema>;

/** The General's split of the Briefing into units and edges (plan.json). */
export const PlanSchema = z.object({
  briefing_version: z.number().int().positive(),
  units: z.array(UnitSchema).min(1),
});
export type Plan = z.infer<typeof PlanSchema>;

export const VERDICTS = ["green", "red"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Result of the deterministic pass on one attempt. */
export interface PassVerdict {
  verdict: Verdict;
  /** Short machine-stable reason, e.g. "out of scope", "tests failed", "locked path". */
  reason: string;
  /** Last lines of output that prove the verdict (at most 30 lines). */
  evidence: string;
}

/** Token counts for one model call, as the Messages API reports them. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}
