import {
  bigserial,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Spec section 7. `events` is append-only and is the single source for the war table and replays.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

export const missions = pgTable("missions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  repoUrl: text("repo_url"),
  repoPath: text("repo_path"),
  goal: text("goal").notNull(),
  status: text("status", { enum: ["interview", "planning", "running", "finished", "failed"] })
    .notNull()
    .default("interview"),
  runner: text("runner", { enum: ["local", "managed"] }).notNull().default("local"),
  budgetCents: integer("budget_cents").notNull(),
  spentCents: integer("spent_cents").notNull().default(0),
  createdAt: createdAt(),
});

export const members = pgTable(
  "members",
  {
    missionId: uuid("mission_id").notNull().references(() => missions.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["commander", "member"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.missionId, t.userId] })],
);

export const briefings = pgTable(
  "briefings",
  {
    missionId: uuid("mission_id").notNull().references(() => missions.id),
    version: integer("version").notNull(),
    markdown: text("markdown").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.missionId, t.version] })],
);

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => missions.id),
  briefingVersion: integer("briefing_version").notNull(),
  json: jsonb("json").notNull(),
  status: text("status", { enum: ["proposed", "approved", "superseded"] }).notNull().default("proposed"),
  createdAt: createdAt(),
});

export const units = pgTable(
  "units",
  {
    planId: uuid("plan_id").notNull().references(() => plans.id),
    id: text("id").notNull(),
    missionId: uuid("mission_id").notNull().references(() => missions.id),
    title: text("title").notNull(),
    task: text("task").notNull(),
    files: text("files").array().notNull(),
    lane: text("lane", { enum: ["open", "gated", "closed"] }).notNull(),
    tier: text("tier").notNull(),
    status: text("status", {
      enum: ["pending", "running", "green", "red", "held", "merged", "failed", "blocked"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    estimateCents: integer("estimate_cents"),
    spentCents: integer("spent_cents").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.planId, t.id] })],
);

export const edges = pgTable("edges", {
  planId: uuid("plan_id").notNull().references(() => plans.id),
  fromUnit: text("from_unit").notNull(),
  toUnit: text("to_unit").notNull(),
  reads: text("reads").notNull(),
});

export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => missions.id),
  unitId: text("unit_id").notNull(),
  n: integer("n").notNull(),
  runnerRef: text("runner_ref"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  result: text("result", { enum: ["green", "red", "error", "cancelled"] }),
});

export const checks = pgTable("checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id").notNull().references(() => attempts.id),
  verdict: text("verdict", { enum: ["green", "red"] }).notNull(),
  reason: text("reason").notNull(),
  evidence: text("evidence").notNull().default(""),
  createdAt: createdAt(),
});

export const dispatches = pgTable("dispatches", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => missions.id),
  unitId: text("unit_id"),
  kind: text("kind", { enum: ["question", "answer", "progress", "blocker", "note"] }).notNull(),
  body: text("body").notNull(),
  source: text("source", { enum: ["station", "cache", "briefing", "human", "general"] }).notNull(),
  briefingRef: text("briefing_ref"),
  parentId: uuid("parent_id"),
  createdAt: createdAt(),
});

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => missions.id),
  kind: text("kind", {
    enum: ["question", "plan_approval", "closed_lane_merge", "gated_retry", "budget_increase"],
  }).notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolution: jsonb("resolution"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const ledger = pgTable("ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => missions.id),
  unitId: text("unit_id"),
  role: text("role").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costCents: numeric("cost_cents", { precision: 12, scale: 4 }).notNull(),
  source: text("source", { enum: ["messages", "managed_session", "claude_code"] }).notNull(),
  createdAt: createdAt(),
});

export const answerCache = pgTable(
  "answer_cache",
  {
    missionId: uuid("mission_id").notNull().references(() => missions.id),
    briefingVersion: integer("briefing_version").notNull(),
    questionHash: text("question_hash").notNull(),
    answer: text("answer").notNull(),
    briefingRef: text("briefing_ref").notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.missionId, t.briefingVersion, t.questionHash] })],
);

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  missionId: uuid("mission_id").notNull().references(() => missions.id),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  type: text("type").notNull(),
  unitId: text("unit_id"),
  payload: jsonb("payload").notNull().default({}),
});
