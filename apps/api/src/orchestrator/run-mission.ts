import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_LANES,
  DEFAULT_LIMITS,
  LanesConfigSchema,
  MemoryEventLog,
  validatePlan,
  type EventSink,
  type LanesConfig,
  type PassVerdict,
  type Plan,
  type PricesConfig,
  type Unit,
  type UnitStatus,
  type Usage,
} from "@bulletin/core";
import {
  afterRed,
  appendLesson,
  attemptTier,
  buildWaves,
  dependentsOf,
  formatSendBack,
  lessonLine,
  mergeDecision,
  promoteLessons,
  readyUnits,
} from "@bulletin/graph";
import { runPass } from "@bulletin/pass-worker/run-pass";
import { integrationBranch, type AttemptHandle, type Runner } from "@bulletin/runners";
import { addWorktree, git, removeWorktree, tryGit } from "@bulletin/runners/git";
import { costCents } from "../treasury/treasury";

export interface MissionOptions {
  missionId: string;
  /** Path to the target repository. */
  repo: string;
  /** All worktrees for the run live under here and are removed as they finish. */
  scratchDir: string;
  /** The branch the integration branch is cut from. */
  baseBranch: string;
  /** plan.json as written by the General; validated before anything runs. */
  plan: unknown;
  runner: Runner;
  prices: PricesConfig;
  /** Tier name to model id (config/models.json "tiers"). */
  tiers: Readonly<Record<string, string>>;
  /** The repository's test command, run by the pass on every attempt. */
  testCommand?: string;
  /** Patterns acceptance commands must match. */
  allowedCommands: readonly string[];
  briefing?: string;
  parallel?: number;
  maxAttempts?: number;
  /** Spend cap handed to each station attempt, in cents. 0 means no per-attempt cap. */
  unitAllowanceCents?: number;
  /** Aborting stops new work: running attempts are cancelled and unstarted units end up blocked. */
  signal?: AbortSignal;
  /** Hard cap for the whole mission in cents. Reaching it pauses the mission (budget.paused). */
  budgetCents?: number;
  events?: EventSink;
}

export interface LedgerRow {
  unitId: string;
  attempt: number;
  role: "station";
  model: string;
  usage: Usage;
  costCents: number;
}

export interface AttemptRecord {
  unitId: string;
  n: number;
  startedAt: number;
  endedAt: number;
  result: "green" | "red" | "error";
  reason: string;
}

export interface MissionReport {
  missionId: string;
  baseBranch: string;
  integrationBranch: string;
  waves: string[][];
  statuses: Record<string, UnitStatus>;
  shipped: string[];
  held: string[];
  failed: string[];
  blocked: string[];
  attempts: AttemptRecord[];
  ledger: LedgerRow[];
  costCents: number;
  /** Times a human has to act: one per unit held for the decision inbox. */
  touches: number;
  /** touches / units shipped; null when nothing shipped. */
  touchRate: number | null;
  /** Ledger spend / units that passed; null when none passed. */
  costPerGreenUnitCents: number | null;
  elapsedMs: number;
}

const LESSONS_PATH = ".bulletin/lessons.md";
const RULES_PATH = ".bulletin/rules.md";

/** Run one thing at a time: merges and lesson writes all touch the integration worktree. */
function mutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };
}

async function readLanes(repo: string, ref: string): Promise<LanesConfig> {
  const r = await tryGit(repo, "show", `${ref}:.bulletin/lanes.json`);
  if (r.code !== 0) return DEFAULT_LANES;
  return LanesConfigSchema.parse(JSON.parse(r.stdout));
}

/**
 * The graph engine (spec section 11): plain code, no model calls. Validates the plan, runs
 * units as their needs merge, sends RED units back alone, merges GREEN units by lane, and
 * returns the report. The only judgment in the loop belongs to whoever cut the plan and to
 * the stations behind the runner.
 */
export async function runMission(options: MissionOptions): Promise<MissionReport> {
  const started = Date.now();
  const events = options.events ?? new MemoryEventLog();
  const parallel = options.parallel ?? DEFAULT_LIMITS.parallel;
  const maxAttempts = options.maxAttempts ?? DEFAULT_LIMITS.maxAttempts;
  const { missionId, repo, runner } = options;
  const emit = (type: Parameters<EventSink["emit"]>[0]["type"], unitId?: string, payload: Record<string, unknown> = {}) =>
    events.emit({ mission_id: missionId, type, unit_id: unitId ?? null, payload });

  await emit("mission.created", undefined, { repo, base: options.baseBranch });

  const repoFiles = (await git(repo, "ls-tree", "-r", "--name-only", options.baseBranch)).split("\n").filter(Boolean);
  const lanes = await readLanes(repo, options.baseBranch);
  const validation = validatePlan(options.plan, { repoFiles, lanes, allowedCommands: options.allowedCommands });
  if (!validation.ok) throw new Error(`plan rejected:\n- ${validation.errors.join("\n- ")}`);
  const plan: Plan = validation.plan;
  const waves = buildWaves(plan);
  await emit("plan.proposed", undefined, { units: plan.units.length, waves: waves.length });
  await emit("plan.approved");

  const integ = integrationBranch(missionId);
  const integDir = join(options.scratchDir, "integration");
  await addWorktree(repo, integDir, integ, options.baseBranch);
  const exclusive = mutex();
  const budgetStop = new AbortController();
  let spent = 0;
  const stopped = () => options.signal?.aborted === true || budgetStop.signal.aborted;
  const active = new Set<AttemptHandle>();
  const cancelActive = () => {
    for (const h of active) void runner.cancel(h).catch(() => undefined);
  };
  options.signal?.addEventListener("abort", cancelActive);
  budgetStop.signal.addEventListener("abort", cancelActive);

  const statuses: Record<string, UnitStatus> = Object.fromEntries(plan.units.map((u) => [u.id, "pending"]));
  const attempts: AttemptRecord[] = [];
  const ledger: LedgerRow[] = [];
  const greens = new Set<string>();

  const block = async (unitId: string) => {
    for (const id of dependentsOf(plan, unitId)) {
      if (statuses[id] === "pending") {
        statuses[id] = "blocked";
        await emit("unit.blocked", id, { waits_on: unitId });
      }
    }
  };

  const recordLesson = (unit: Unit, reason: string) =>
    exclusive(async () => {
      await mkdir(join(integDir, ".bulletin"), { recursive: true });
      const read = async (path: string) => readFile(join(integDir, path), "utf8").catch(() => "");
      const lessons = appendLesson(await read(LESSONS_PATH), lessonLine(unit.id, unit.title, reason));
      await writeFile(join(integDir, LESSONS_PATH), lessons, "utf8");
      const rules = await read(RULES_PATH);
      const promoted = promoteLessons(lessons, rules);
      if (promoted !== rules) await writeFile(join(integDir, RULES_PATH), promoted, "utf8");
      await git(integDir, "add", "-A", ".bulletin");
      await git(integDir, "commit", "-q", "-m", `lesson: ${unit.id} came back for ${reason}`);
    });

  const merge = (unit: Unit, branch: string) =>
    exclusive(async () => {
      const r = await tryGit(integDir, "merge", "--no-ff", "-q", "-m", `ship ${unit.id}: ${unit.title}`, branch);
      if (r.code !== 0) await tryGit(integDir, "merge", "--abort");
      return r.code === 0;
    });

  const runUnit = async (unit: Unit): Promise<void> => {
    await emit("unit.started", unit.id, { lane: unit.lane });
    let packet: string | undefined;
    let lastReason: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (stopped()) {
        lastReason = "stopped";
        break;
      }
      const tier = attemptTier(unit.tier, attempt, lastReason);
      const model = options.tiers[tier] ?? options.tiers[unit.tier];
      if (!model) throw new Error(`no model for tier: ${unit.tier}`);
      const startedAt = Date.now();
      await emit("attempt.started", unit.id, { attempt, tier, model });

      const rules = await readFile(join(integDir, RULES_PATH), "utf8").catch(() => "");
      const handle = await runner.startAttempt({
        missionId,
        unit,
        attempt,
        baseBranch: integ,
        briefingSlice: options.briefing ?? "",
        rules,
        sendBack: packet,
        model,
        allowanceCents: options.unitAllowanceCents ?? 0,
      });

      let stationError: string | undefined;
      active.add(handle);
      for await (const event of runner.events(handle)) {
        if (event.type === "usage") {
          const row: LedgerRow = {
            unitId: unit.id,
            attempt,
            role: "station",
            model: event.model,
            usage: event.usage,
            costCents: event.costCents ?? costCents(event.model, event.usage, options.prices),
          };
          ledger.push(row);
          await emit("ledger.charged", unit.id, { attempt, model: row.model, cost_cents: row.costCents });
          spent += row.costCents;
          if (options.budgetCents !== undefined && spent >= options.budgetCents && !budgetStop.signal.aborted) {
            await emit("budget.paused", unit.id, { spent_cents: spent, budget_cents: options.budgetCents });
            budgetStop.abort();
          }
        } else if (event.type === "done" && !event.ok) {
          stationError = event.error ?? "station failed";
        }
      }
      active.delete(handle);

      let verdict: PassVerdict;
      try {
        verdict = stationError
          ? { verdict: "red", reason: "station error", evidence: stationError }
          : await runPass({
              repo,
              scratchDir: options.scratchDir,
              unit,
              unitBranch: handle.branch,
              integrationBranch: integ,
              testCommand: options.testCommand,
            });
      } finally {
        if (handle.workdir) await removeWorktree(repo, handle.workdir);
      }

      const green = verdict.verdict === "green";
      attempts.push({
        unitId: unit.id,
        n: attempt,
        startedAt,
        endedAt: Date.now(),
        result: green ? "green" : stationError ? "error" : "red",
        reason: verdict.reason,
      });
      await emit(green ? "pass.green" : "pass.red", unit.id, { attempt, reason: verdict.reason });
      await emit("attempt.ended", unit.id, { attempt, result: verdict.verdict });

      if (green) {
        greens.add(unit.id);
        if (mergeDecision(unit.lane, attempt) === "hold") {
          statuses[unit.id] = "held";
          await emit("unit.held", unit.id, { lane: unit.lane, attempt, branch: handle.branch });
          await emit("decision.opened", unit.id, {
            kind: unit.lane === "closed" ? "closed_lane_merge" : "gated_retry",
            branch: handle.branch,
          });
          await block(unit.id);
          return;
        }
        if (await merge(unit, handle.branch)) {
          statuses[unit.id] = "merged";
          await emit("unit.merged", unit.id, { attempt });
          return;
        }
        verdict = { verdict: "red", reason: "merge conflict", evidence: `${handle.branch} does not merge into ${integ}` };
        greens.delete(unit.id);
      }

      lastReason = verdict.reason;
      await recordLesson(unit, verdict.reason);
      packet = formatSendBack({ unitId: unit.id, attempt, maxAttempts, verdict, files: unit.files });
      await emit("unit.sent_back", unit.id, { attempt, reason: verdict.reason });
      if (afterRed(attempt, maxAttempts) === "fail") break;
    }

    statuses[unit.id] = "failed";
    await emit("unit.failed", unit.id, { reason: lastReason });
    await block(unit.id);
  };

  const running = new Map<string, Promise<void>>();
  let wave = 0;
  for (;;) {
    const ready = readyUnits(plan, statuses);
    if (ready.length > 0 && running.size === 0) {
      wave += 1;
      await emit("wave.started", undefined, { wave, units: ready.map((u) => u.id) });
    }
    for (const unit of ready) {
      if (stopped() || running.size >= parallel) break;
      statuses[unit.id] = "running";
      const task = runUnit(unit).finally(() => running.delete(unit.id));
      running.set(unit.id, task);
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  // Anything still pending waits on a unit that never merged.
  for (const unit of plan.units) {
    if (statuses[unit.id] === "pending") {
      statuses[unit.id] = "blocked";
      await emit("unit.blocked", unit.id);
    }
  }
  await removeWorktree(repo, integDir);

  const by = (status: UnitStatus) => plan.units.filter((u) => statuses[u.id] === status).map((u) => u.id);
  const total = Math.round(ledger.reduce((sum, row) => sum + row.costCents, 0) * 1e4) / 1e4;
  const shipped = by("merged");
  const held = by("held");
  const report: MissionReport = {
    missionId,
    baseBranch: options.baseBranch,
    integrationBranch: integ,
    waves: waves.map((w) => w.map((u) => u.id)),
    statuses,
    shipped,
    held,
    failed: by("failed"),
    blocked: by("blocked"),
    attempts,
    ledger,
    costCents: total,
    touches: held.length,
    touchRate: shipped.length ? held.length / shipped.length : null,
    costPerGreenUnitCents: greens.size ? Math.round((total / greens.size) * 1e4) / 1e4 : null,
    elapsedMs: Date.now() - started,
  };
  await emit("mission.finished", undefined, {
    stopped: options.signal?.aborted === true,
    paused: budgetStop.signal.aborted,
    shipped: shipped.length,
    held: held.length,
    failed: report.failed.length,
    blocked: report.blocked.length,
    cost_cents: total,
    touches: report.touches,
  });
  return report;
}

/** The plain-text report printed at the end of `bulletin run`. */
export function formatReport(r: MissionReport): string {
  const list = (ids: string[]) => (ids.length ? ids.join(" ") : "-");
  const cents = (c: number | null) => (c === null ? "-" : `$${(c / 100).toFixed(4)}`);
  return [
    `Mission ${r.missionId}`,
    `waves        ${r.waves.map((w) => `[${w.join(" ")}]`).join(" ")}`,
    `shipped      ${list(r.shipped)}`,
    `held         ${list(r.held)}`,
    `failed       ${list(r.failed)}`,
    `blocked      ${list(r.blocked)}`,
    `attempts     ${r.attempts.length}`,
    `cost         ${cents(r.costCents)} over ${r.ledger.length} model calls`,
    `per green    ${cents(r.costPerGreenUnitCents)}`,
    `touches      ${r.touches}`,
    `touch rate   ${r.touchRate === null ? "-" : r.touchRate.toFixed(2)}`,
    `elapsed      ${(r.elapsedMs / 1000).toFixed(1)}s`,
    `review       git diff ${r.baseBranch}...${r.integrationBranch}`,
  ].join("\n");
}
