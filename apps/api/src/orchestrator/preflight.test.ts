import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryEventLog, type PricesConfig } from "@bulletin/core";
import { StubRunner, type StubScript } from "@bulletin/runners/stub-runner";
import { attemptEstimateCents, Reservations } from "./preflight";
import { runMission } from "./run-mission";

// Real git; the default 5s is too tight on a loaded Windows machine.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

// model-a: $1 per million input tokens, so 40,000 input tokens is exactly 4 cents.
const prices: PricesConfig = {
  currency: "USD",
  unit: "per_million_tokens",
  as_of: "test",
  models: { "model-a": { input: 1, output: 5, cache_write: 1, cache_read: 0.1 } },
};
const FOUR_CENTS = { input_tokens: 40_000, output_tokens: 0 };

describe("attemptEstimateCents", () => {
  const unit = { tier: "station", estimate: FOUR_CENTS };
  it("prices the unit's estimate at the model for its tier", () => {
    expect(attemptEstimateCents(unit, "model-a", prices)).toBeCloseTo(4, 6);
  });
  it("scales by the tier's calibration factor", () => {
    expect(attemptEstimateCents(unit, "model-a", prices, { station: 0.5 })).toBeCloseTo(2, 6);
    expect(attemptEstimateCents(unit, "model-a", prices, { escalated: 3 })).toBeCloseTo(4, 6);
  });
  it("ignores a calibration factor that is zero, negative or not a number", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(attemptEstimateCents(unit, "model-a", prices, { station: bad })).toBeCloseTo(4, 6);
    }
  });
  it("is zero for a unit with no estimate, so it adds nothing to the preflight", () => {
    expect(attemptEstimateCents({ tier: "station" }, "model-a", prices)).toBe(0);
  });
});

describe("Reservations", () => {
  it("counts what running attempts may still spend, not what they already charged", () => {
    const r = new Reservations();
    r.reserve("a", 4);
    r.reserve("b", 4);
    expect(r.total()).toBe(8);
    r.charge("a", 1.5);
    expect(r.total()).toBe(6.5);
    r.charge("a", 10); // overspent its estimate: it reserves nothing more, never goes negative
    expect(r.total()).toBe(4);
    r.release("a");
    expect(r.total()).toBe(4);
    r.release("b");
    expect(r.total()).toBe(0);
  });
  it("ignores charges and releases for an attempt it does not know", () => {
    const r = new Reservations();
    r.charge("x", 5);
    r.release("x");
    expect(r.total()).toBe(0);
  });
});

/* ---- In the engine ---- */

let root: string;
let repo: string;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const put = (path: string, contents: string) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bulletin-preflight-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "test");
  sh(repo, "config", "user.email", "test@example.com");
  sh(repo, "config", "core.autocrlf", "false");
  put("check.mjs", 'console.log("check ok");\n');
  for (const f of ["a", "b", "c"]) put(`src/${f}.ts`, `export const ${f} = 0;\n`);
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
});
afterEach(() => {
  try {
    sh(repo, "worktree", "prune");
  } catch {
    /* gone */
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const unit = (id: string, estimate?: { input_tokens: number; output_tokens: number }) => ({
  id,
  title: `Unit ${id}`,
  task: `Write src/${id}.ts`,
  files: [`src/${id}.ts`],
  ...(estimate ? { estimate } : {}),
});

function run(units: unknown[], extra: Record<string, unknown> = {}) {
  const events = new MemoryEventLog();
  const started: string[] = [];
  const runner = new StubRunner(repo, join(root, "stations"), (input) => {
    started.push(input.unit.id);
    return { files: { [input.unit.files[0]!]: `export const x = 1; // ${input.unit.id}\n` } };
  });
  return runMission({
    missionId: "m1",
    repo,
    scratchDir: join(root, "scratch"),
    baseBranch: "main",
    plan: { briefing_version: 1, units },
    runner,
    prices,
    tiers: { station: "model-a" },
    testCommand: "node check.mjs",
    allowedCommands: ["node *"],
    events,
    ...extra,
  }).then((result) => ({ result, events, started }));
}

/** The mission.finished event says whether the mission ended paused. */
const pausedOf = (events: MemoryEventLog) => events.events.find((e) => e.type === "mission.finished")?.payload.paused;

describe("treasury preflight in the engine", () => {
  it("does not start an attempt whose estimate does not fit what is left, and says so", async () => {
    // Three units of 4 cents each, all ready at once, against a 10 cent budget: two fit, the third does not.
    const { result, events, started } = await run([unit("a", FOUR_CENTS), unit("b", FOUR_CENTS), unit("c", FOUR_CENTS)], {
      budgetCents: 10,
      parallel: 3,
    });
    expect(started.sort()).toEqual(["a", "b"]);
    expect(result.statuses).toMatchObject({ a: "merged", b: "merged", c: "blocked" });
    expect(pausedOf(events)).toBe(true);

    const paused = events.events.filter((e) => e.type === "budget.paused");
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({
      unit_id: "c",
      payload: { preflight: true, budget_cents: 10, estimate_cents: 4, reserved_cents: 8, shortfall_cents: expect.closeTo(2, 3) },
    });
    // The attempt for c never began.
    expect(events.events.some((e) => e.type === "attempt.started" && e.unit_id === "c")).toBe(false);
  });

  it("pauses at once when even the first unit's estimate exceeds the budget", async () => {
    const { result, events, started } = await run([unit("a", FOUR_CENTS)], { budgetCents: 1 });
    expect(started).toEqual([]);
    expect(pausedOf(events)).toBe(true);
    expect(events.events.filter((e) => e.type === "budget.paused")).toHaveLength(1);
    expect(result.shipped).toEqual([]);
  });

  it("lets running attempts finish when it pauses new ones", async () => {
    const { result, started } = await run([unit("a", FOUR_CENTS), unit("b", FOUR_CENTS)], { budgetCents: 6, parallel: 2 });
    expect(started).toEqual(["a"]);
    expect(result.statuses.a).toBe("merged"); // not cancelled
    expect(result.statuses.b).toBe("blocked");
  });

  it("scales estimates by the calibration factors it is given", async () => {
    const units = [unit("a", FOUR_CENTS), unit("b", FOUR_CENTS)];
    const plain = await run(units, { budgetCents: 5, parallel: 2 });
    expect(plain.started).toEqual(["a"]);

    const calibrated = await run(units, { missionId: "m2", budgetCents: 5, parallel: 2, calibration: { station: 0.5 } });
    expect(calibrated.started.sort()).toEqual(["a", "b"]);
    expect(pausedOf(calibrated.events)).toBe(false);
  });

  it("parks every unit it holds back as blocked, not failed, even ones that were never looked at", async () => {
    // a (12 cents) is refused first; b and c (2 cents each) start at the same moment and must not end 'failed'.
    const { result, events, started } = await run(
      [unit("a", { input_tokens: 120_000, output_tokens: 0 }), unit("b", { input_tokens: 20_000, output_tokens: 0 }), unit("c", { input_tokens: 20_000, output_tokens: 0 })],
      { budgetCents: 10, parallel: 3 },
    );
    expect(started).toEqual([]);
    expect(result.statuses).toEqual({ a: "blocked", b: "blocked", c: "blocked" });
    expect(events.events.some((e) => e.type === "unit.failed")).toBe(false);
    expect(events.events.filter((e) => e.type === "budget.paused")).toHaveLength(1);
  });

  it("parks a unit whose send-back retry no longer fits, instead of failing it for good", async () => {
    const events = new MemoryEventLog();
    const script: StubScript = (input) => {
      if (input.attempt === 1) return { files: {} as Record<string, string>, error: "first try goes wrong" };
      return { files: { "src/a.ts": "export const x = 1;\n" } };
    };
    const runner = new StubRunner(repo, join(root, "stations"), script);
    const result = await runMission({
      missionId: "m3",
      repo,
      scratchDir: join(root, "scratch"),
      baseBranch: "main",
      plan: { briefing_version: 1, units: [unit("a", FOUR_CENTS)] },
      runner,
      prices,
      tiers: { station: "model-a" },
      testCommand: "node check.mjs",
      allowedCommands: ["node *"],
      events,
      budgetCents: 4.1, // attempt 1 fits (4); attempt 2 would need 0.15 spent + 4
    });
    expect(result.statuses.a).toBe("blocked");
    expect(result.attempts.filter((a) => a.unitId === "a")).toHaveLength(1);
    expect(events.events.some((e) => e.type === "unit.failed")).toBe(false);
    expect(events.events.find((e) => e.type === "unit.blocked")?.payload).toMatchObject({ reason: "budget_paused", attempts: 1 });
  });

  it("changes nothing for a mission without a budget or without estimates", async () => {
    const noBudget = await run([unit("a", FOUR_CENTS), unit("b", FOUR_CENTS)], { parallel: 2 });
    expect(noBudget.result.shipped.sort()).toEqual(["a", "b"]);
    expect(pausedOf(noBudget.events)).toBe(false);
  });
});
