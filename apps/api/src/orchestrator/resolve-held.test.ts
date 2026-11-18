import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryEventLog, type BulletinEvent, type PricesConfig } from "@bulletin/core";
import { StubRunner, type StubScript } from "@bulletin/runners/stub-runner";
import { resolveHeld, statusesFromEvents } from "./resolve-held";
import { runMission } from "./run-mission";

// Real git and child processes; the default 5s is too tight on a loaded Windows machine.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const prices: PricesConfig = {
  currency: "USD",
  unit: "per_million_tokens",
  as_of: "test",
  models: { "model-a": { input: 1, output: 5, cache_write: 1, cache_read: 0.1 } },
};
const tiers = { station: "model-a" };

const CHECK = `
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const bad = walk("src").filter((f) => readFileSync(f, "utf8").includes("BROKEN"));
if (bad.length) { console.error("check failed: BROKEN found in " + bad.join(", ")); process.exit(1); }
console.log("check ok");
`;

let root: string;
let repo: string;
let scratch: string;

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function writeRepoFile(path: string, contents: string) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bulletin-held-"));
  repo = join(root, "repo");
  scratch = join(root, "scratch");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "test");
  sh(repo, "config", "user.email", "test@example.com");
  sh(repo, "config", "core.autocrlf", "false");
  writeRepoFile("check.mjs", CHECK);
  for (const f of ["a", "b", "c"]) writeRepoFile(`src/${f}.ts`, `export const ${f} = 0;\n`);
  writeRepoFile("src/secret/k.ts", "export const k = 0;\n");
  writeRepoFile(".bulletin/lanes.json", JSON.stringify({ closed: ["src/secret/**"], gated: [] }));
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
});

afterEach(() => {
  try {
    sh(repo, "worktree", "prune");
  } catch {
    /* the repo may already be gone */
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const unit = (id: string, file: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Unit ${id}`,
  task: `Write ${file}`,
  files: [file],
  ...extra,
});
const good = (file: string) => ({ files: { [file]: `export const x = 1; // ${file}\n` } });

/** Everything resolveHeld needs from the first run, so each test reads like a story. */
function mission(units: unknown[], script: StubScript, started: string[] = []) {
  const plan = { briefing_version: 1, units };
  const events = new MemoryEventLog();
  const track: StubScript = (input) => {
    started.push(input.unit.id);
    return script(input);
  };
  const base = {
    missionId: "m1",
    repo,
    scratchDir: scratch,
    baseBranch: "main",
    plan,
    runner: new StubRunner(repo, join(scratch, "stations"), track),
    prices,
    tiers,
    testCommand: "node check.mjs",
    allowedCommands: ["node *"],
  };
  return {
    base,
    events,
    first: () => runMission({ ...base, events }),
    resolve: (unitId: string, resolution: "approve" | "reject", history: readonly BulletinEvent[] = events.events) =>
      resolveHeld({ ...base, events, history, unitId, resolution }),
  };
}

const blocking = [
  unit("h", "src/secret/k.ts"),
  unit("d", "src/b.ts", { needs: [{ unit: "h", reads: "k constant in src/secret/k.ts" }] }),
];

describe("statusesFromEvents", () => {
  it("replays unit events, last one wins", () => {
    const log = new MemoryEventLog();
    const e = (type: Parameters<MemoryEventLog["emit"]>[0]["type"], unit_id: string) => log.emit({ mission_id: "m", type, unit_id });
    return (async () => {
      await e("unit.started", "a");
      await e("unit.merged", "a");
      await e("unit.started", "b");
      await e("unit.held", "b");
      await e("unit.blocked", "c");
      await e("unit.failed", "d");
      expect(statusesFromEvents(log.events)).toEqual({ a: "merged", b: "held", c: "blocked", d: "failed" });
    })();
  });
});

describe("resolveHeld", () => {
  it("approve merges the held branch and runs the units it was blocking", async () => {
    const started: string[] = [];
    const m = mission(blocking, (input) => good(input.unit.files[0]!), started);
    const first = await m.first();
    expect(first.statuses).toMatchObject({ h: "held", d: "blocked" });
    expect(started).toEqual(["h"]);

    const result = await m.resolve("h", "approve");

    expect(result.outcome).toBe("merged");
    if (result.outcome !== "merged") return;
    expect(result.unblocked).toEqual(["d"]);
    expect(started).toEqual(["h", "d"]);
    expect(result.statuses).toMatchObject({ h: "merged", d: "merged" });
    expect(result.report?.shipped.sort()).toEqual(["d", "h"]);

    expect(sh(repo, "show", `${first.integrationBranch}:src/secret/k.ts`)).toContain("src/secret/k.ts");
    expect(sh(repo, "show", `${first.integrationBranch}:src/b.ts`)).toContain("src/b.ts");
    expect(sh(repo, "show", "main:src/secret/k.ts")).toBe("export const k = 0;");

    const types = m.events.events.map((e) => `${e.type}:${e.unit_id ?? ""}`);
    expect(types).toContain("unit.merged:h");
    expect(types).toContain("unit.merged:d");
    expect(types.filter((t) => t === "mission.created:")).toHaveLength(1);
    const waves = m.events.events.filter((e) => e.type === "wave.started").map((e) => e.payload.wave);
    expect(waves).toEqual([1, 2]);
    const last = m.events.events.at(-1)!;
    expect(last.type).toBe("mission.finished");
    expect(last.payload).toMatchObject({ resumed: true, shipped: 2, held: 0 });

    // nothing is left behind
    expect(sh(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  it("reject marks the unit failed, leaves the integration branch alone and starts nothing", async () => {
    const started: string[] = [];
    const m = mission(blocking, (input) => good(input.unit.files[0]!), started);
    const first = await m.first();
    const before = sh(repo, "rev-parse", first.integrationBranch);

    const result = await m.resolve("h", "reject");

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") return;
    expect(result.statuses).toMatchObject({ h: "failed", d: "blocked" });
    expect(started).toEqual(["h"]);
    expect(sh(repo, "rev-parse", first.integrationBranch)).toBe(before);
    const failed = m.events.events.find((e) => e.type === "unit.failed" && e.unit_id === "h");
    expect(failed?.payload).toMatchObject({ reason: "rejected" });
  });

  it("keeps a dependent blocked when it also waits on a unit that failed", async () => {
    const started: string[] = [];
    const units = [
      unit("h", "src/secret/k.ts"),
      unit("f", "src/c.ts"),
      unit("d", "src/b.ts", {
        needs: [
          { unit: "h", reads: "k constant in src/secret/k.ts" },
          { unit: "f", reads: "c constant in src/c.ts" },
        ],
      }),
    ];
    const m = mission(units, (input) => (input.unit.id === "f" ? { files: { "src/c.ts": "BROKEN\n" } } : good(input.unit.files[0]!)), started);
    const first = await m.first();
    expect(first.statuses).toMatchObject({ h: "held", f: "failed", d: "blocked" });

    const result = await m.resolve("h", "approve");

    expect(result.outcome).toBe("merged");
    if (result.outcome !== "merged") return;
    expect(result.unblocked).toEqual([]);
    expect(result.statuses).toMatchObject({ h: "merged", f: "failed", d: "blocked" });
    expect(started).not.toContain("d");
  });

  it("only merges, and runs nothing, when the mission was stopped", async () => {
    const started: string[] = [];
    const m = mission(blocking, (input) => good(input.unit.files[0]!), started);
    await m.first();
    const history = m.events.events.map((e) => (e.type === "mission.finished" ? { ...e, payload: { ...e.payload, stopped: true } } : e));
    const result = await m.resolve("h", "approve", history);
    expect(result.outcome).toBe("merged");
    if (result.outcome !== "merged") return;
    expect(result.unblocked).toEqual([]);
    expect(started).toEqual(["h"]);
  });

  it("reports a merge conflict and changes nothing when the integration branch moved", async () => {
    const m = mission(blocking, (input) => good(input.unit.files[0]!));
    const first = await m.first();
    // Someone else changed the same file on the integration branch after the unit went green.
    const dir = join(root, "other");
    sh(repo, "worktree", "add", "-q", dir, first.integrationBranch);
    writeFileSync(join(dir, "src/secret/k.ts"), "export const k = 99; // elsewhere\n");
    sh(dir, "add", "-A");
    sh(dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "elsewhere");
    sh(repo, "worktree", "remove", "--force", dir);
    const before = sh(repo, "rev-parse", first.integrationBranch);
    const eventCount = m.events.events.length;

    const result = await m.resolve("h", "approve");

    expect(result.outcome).toBe("conflict");
    expect(sh(repo, "rev-parse", first.integrationBranch)).toBe(before);
    expect(m.events.events).toHaveLength(eventCount);
  });

  it("refuses a unit that is not held, and a mission that has not finished", async () => {
    const m = mission(blocking, (input) => good(input.unit.files[0]!));
    await m.first();
    expect((await m.resolve("d", "approve")).outcome).toBe("not_held");
    expect((await m.resolve("nope", "approve")).outcome).toBe("not_held");
    const running = m.events.events.filter((e) => e.type !== "mission.finished");
    expect((await m.resolve("h", "approve", running)).outcome).toBe("mission_running");
  });

  it("resolves a held unit once: a second approve finds it already merged", async () => {
    const m = mission(blocking, (input) => good(input.unit.files[0]!));
    await m.first();
    expect((await m.resolve("h", "approve")).outcome).toBe("merged");
    expect((await m.resolve("h", "approve")).outcome).toBe("not_held");
  });

  it("carries the spend so far into the budget of the continuation", async () => {
    // model-a: 1 million input tokens is 100 cents. Budget 150: h spends 100, d would reach 200.
    const started: string[] = [];
    const m = mission(
      blocking,
      (input) => ({ ...good(input.unit.files[0]!), usage: { input_tokens: 1_000_000, output_tokens: 0 } }),
      started,
    );
    m.base.plan.units.push(unit("e", "src/c.ts", { needs: [{ unit: "d", reads: "b constant in src/b.ts" }] }));
    await runMission({ ...m.base, events: m.events, budgetCents: 150 });
    const result = await resolveHeld({ ...m.base, events: m.events, history: m.events.events, unitId: "h", resolution: "approve", budgetCents: 150 });
    expect(result.outcome).toBe("merged");
    // 100 already spent + 100 for d reaches 150, so the mission pauses and e never starts
    expect(started).toEqual(["h", "d"]);
    expect(m.events.events.filter((e) => e.type === "budget.paused")).toHaveLength(1);
  });
});
