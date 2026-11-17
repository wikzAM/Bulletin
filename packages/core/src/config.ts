import { readFileSync } from "node:fs";
import { z } from "zod";

const RoleModelSchema = z.object({
  model: z.string().min(1),
  fallback: z.string().min(1).optional(),
  escalate: z.string().min(1).optional(),
});

/** config/models.json - model ids live here, never in code. */
export const ModelsConfigSchema = z.object({
  roles: z.record(z.string(), RoleModelSchema),
  tiers: z.record(z.string(), z.string().min(1)),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

/** Dollars per million tokens for one model. */
export const ModelPriceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache_write: z.number().nonnegative(),
  cache_read: z.number().nonnegative(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

/** config/prices.json - prices live here, never in code. */
export const PricesConfigSchema = z.object({
  currency: z.literal("USD"),
  unit: z.literal("per_million_tokens"),
  as_of: z.string(),
  models: z.record(z.string(), ModelPriceSchema),
});
export type PricesConfig = z.infer<typeof PricesConfigSchema>;

/** .bulletin/lanes.json in the target repository: glob patterns per lane. */
export const LanesConfigSchema = z.object({
  closed: z.array(z.string()).default([]),
  gated: z.array(z.string()).default([]),
});
export type LanesConfig = z.infer<typeof LanesConfigSchema>;

/** Paths no unit may own or change (spec section 8, rule 5). */
export const LOCKED_PATHS: readonly string[] = [
  ".bulletin/**",
  ".github/**",
  "plan.json",
  "**/vitest.config.*",
  "**/jest.config.*",
  "**/eslint.config.*",
  "**/.eslintrc*",
  "**/tsconfig*.json",
];

export const DEFAULT_LANES: LanesConfig = {
  closed: ["**/migrations/**", "**/*migration*", "**/*payment*", "infra/**", "**/*.env*", "**/*secret*"],
  gated: ["**/package.json", "**/pnpm-lock.yaml", "**/package-lock.json", "**/shared/**", "**/db/**", "**/*schema*"],
};

/** Starting assumptions from the spec; every one is configurable per mission. */
export const DEFAULT_LIMITS = {
  maxUnits: 12,
  maxAttempts: 3,
  parallel: 4,
  maxQuestionsPerAttempt: 10,
  maxDiffLines: 400,
  evidenceLines: 30,
  fareOverhead: 0.15,
  fareHighMultiplier: 1.8,
} as const;

function loadJson<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export const loadModelsConfig = (path: string): ModelsConfig => loadJson(path, ModelsConfigSchema);
export const loadPricesConfig = (path: string): PricesConfig => loadJson(path, PricesConfigSchema);
export const loadLanesConfig = (path: string): LanesConfig => loadJson(path, LanesConfigSchema);
