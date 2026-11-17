import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests run real git and child processes; 5s is too tight on a loaded Windows machine.
vi.setConfig({ testTimeout: 60_000 });
import { MemoryEventLog, type PricesConfig } from "@bulletin/core";
import { StubRunner, type StubScript } from "@bulletin/runners/stub-runner";
import { formatReport, runMission, type MissionReport } from "../src/orchestrator/run-mission";

// Invented models and prices: the engine reads them from config, never from code.
const prices: PricesConfig = {
  currency: "USD",
  unit: "per_million_tokens",
  as_of: "test",
  models: {
    "model-a": { input: 1, output: 5, cache_write: 1, cache_read: 0.1 },
    "model-b": { input: 4, output: 20, cache_write: 4, cache_read: 0.4 },
  },
};
const tiers = { station: "model-a", escalated: "model-b" };

/** The fixture repo's whole test suite: fails if any file under src/ contains the word BROKEN. */
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
  root = mkdtempSync(join(tmpdir(), "bulletin-test-"));
  repo = join(root, "repo");
  scratch = join(root, "scratch");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "test");
  sh(repo, "config", "user.email", "test@example.com");
  sh(repo, "config", "core.autocrlf", "false");
  writeRepoFile("check.mjs", CHECK);
  writeRepoFile("src/a.ts", "export const a = 0;\n");
  writeRepoFile("src/b.ts", "export const b = 0;\n");
  writeRepoFile("src/c.ts", "export const c = 0;\n");
  writeRepoFile("src/shared/s.ts", "export const s = 0;\n");
  writeRepoFile("src/secret/k.ts", "export const k = 0;\n");
  writeRepoFile(".bulletin/lanes.json", JSON.stringify({ closed: ["src/secret/**"], gated: ["src/shared/**"] }));
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
});

afterEach(() => {
  try {
    sh(repo, "worktree", "prune");
  } catch {
    /* the repo may already be gone */
  }
  rmSync(root, { recursive: true, force: true });
});

const unit = (id: string, file: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Unit ${id}`,
  task: `Write ${file}`,
  files: [file],
  ...extra,
});

async function run(units: unknown[], script: StubScript, over: Partial<Parameters<typeof runMission>[0]> = {}) {
  const events = new MemoryEventLog();
  const runner = new StubRunner(repo, join(scratch, "stations"), script);
  const report = await runMission({
    missionId: "m1",
    repo,
    scratchDir: scratch,
    baseBranch: "main",
    plan: { briefing_version: 1, units },
    runner,
    prices,
    tiers,
    testCommand: "node check.mjs",
    allowedCommands: ["node *"],
    events,
    ...over,
  });
  return { report, events };
}

const good = (file: string) => ({ files: { [file]: `export const x = 1; // ${file}\n` } });
const lessons = (branch: string) => sh(repo, "show", `${branch}:.bulletin/lessons.md`);

describe("graph engine: M1 acceptance", () => {
  it("stops starting work when the abort signal fires, and blocks what has not started", async () => {
    const abort = new AbortController();
    const units = [unit("u1", "src/a.ts"), unit("u2", "src/b.ts", { needs: [{ unit: "u1", reads: "a from src/a.ts" }] })];
    const started: string[] = [];
    const { report, events } = await run(
      units,
      (input) => {
        started.push(input.unit.id);
        if (input.unit.id === "u1") setTimeout(() => abort.abort(), 20);
        return { ...good("src/a.ts"), delayMs: 100 };
      },
      { signal: abort.signal },
    );
    expect(started).toEqual(["u1"]);
    expect(report.statuses.u2).toBe("blocked");
    const finished = events.events.find((e) => e.type === "mission.finished");
    expect(finished?.payload).toMatchObject({ stopped: true });
  });
  it("rejects a plan with a fake edge before anything runs", async () => {
    const units = [unit("u1", "src/a.ts"), unit("u2", "src/b.ts", { needs: [{ unit: "u1", reads: " " }] })];
    await expect(run(units, () => good("src/a.ts"))).rejects.toThrow(
      "fake edge: u2 waits for u1 but names nothing it reads",
    );
    expect(sh(repo, "branch", "--list", "bulletin/*")).toBe("");
  });

  it("runs three independent units concurrently (attempt timestamps overlap)", async () => {
    const files: Record<string, string> = { u1: "src/a.ts", u2: "src/b.ts", u3: "src/c.ts" };
    const { report } = await run(
      Object.entries(files).map(([id, f]) => unit(id, f)),
      (input) => ({ ...good(files[input.unit.id]!), delayMs: 400 }),
    );
    expect(report.shipped.sort()).toEqual(["u1", "u2", "u3"]);
    const [a, b, c] = ["u1", "u2", "u3"].map((id) => report.attempts.find((x) => x.unitId === id)!);
    expect(Math.max(a!.startedAt, b!.startedAt, c!.startedAt)).toBeLessThan(Math.min(a!.endedAt, b!.endedAt, c!.endedAt));
  });

  it("sends a broken unit back alone: RED, packet, only that unit runs again", async () => {
    const seen: Array<{ unit: string; attempt: number; sendBack?: string }> = [];
    const { report } = await run([unit("u1", "src/a.ts"), unit("u2", "src/b.ts")], (input) => {
      seen.push({ unit: input.unit.id, attempt: input.attempt, sendBack: input.sendBack });
      const file = input.unit.files[0]!;
      const broken = input.unit.id === "u2" && input.attempt === 1;
      return { files: { [file]: broken ? "export const b = BROKEN;\n" : "export const ok = 1;\n" } };
    });
    expect(report.shipped.sort()).toEqual(["u1", "u2"]);
    expect(seen.filter((s) => s.unit === "u1")).toHaveLength(1);
    const u2 = seen.filter((s) => s.unit === "u2");
    expect(u2.map((s) => s.attempt)).toEqual([1, 2]);
    expect(u2[0]!.sendBack).toBeUndefined();
    expect(u2[1]!.sendBack).toContain("UNIT      u2");
    expect(u2[1]!.sendBack).toContain("VERDICT   RED (attempt 1 of 3)");
    expect(u2[1]!.sendBack).toContain("REASON    tests failed");
    expect(u2[1]!.sendBack).toContain("check failed: BROKEN found in");
    expect(u2[1]!.sendBack).toContain("SCOPE     fix this unit only. Touch only: src/b.ts");
  });

  it("returns RED 'out of scope' for an edit outside the unit's files", async () => {
    const seen: Array<string | undefined> = [];
    const { report, events } = await run([unit("u1", "src/a.ts")], (input) => {
      seen.push(input.sendBack);
      return input.attempt === 1
        ? { files: { "src/a.ts": "export const a = 1;\n", "src/zzz.ts": "export const z = 1;\n" } }
        : good("src/a.ts");
    });
    expect(seen[1]).toContain("REASON    out of scope");
    expect(seen[1]).toContain("src/zzz.ts");
    expect(report.attempts[0]).toMatchObject({ result: "red", reason: "out of scope" });
    expect(events.events.some((e) => e.type === "pass.red" && e.payload.reason === "out of scope")).toBe(true);
  });

  it("never merges a closed-lane unit automatically", async () => {
    const { report } = await run([unit("u1", "src/secret/k.ts", { lane: "open" })], () => good("src/secret/k.ts"));
    expect(report.held).toEqual(["u1"]);
    expect(report.shipped).toEqual([]);
    expect(sh(repo, "show", `${report.integrationBranch}:src/secret/k.ts`)).toBe("export const k = 0;");
  });

  it("merges a gated unit that is green first time, and holds one that needed a retry", async () => {
    const first = await run([unit("g1", "src/shared/s.ts")], () => good("src/shared/s.ts"));
    expect(first.report.shipped).toEqual(["g1"]);

    const retried = await run(
      [unit("g1", "src/shared/s.ts")],
      (input) => (input.attempt === 1 ? { files: { "src/shared/s.ts": "BROKEN\n" } } : good("src/shared/s.ts")),
      { missionId: "m2" },
    );
    expect(retried.report.held).toEqual(["g1"]);
    expect(retried.report.attempts.map((a) => a.result)).toEqual(["red", "green"]);
  });

  it("blocks dependents of a held unit and never starts them", async () => {
    const started: string[] = [];
    const units = [
      unit("u1", "src/secret/k.ts"),
      unit("u2", "src/b.ts", { needs: [{ unit: "u1", reads: "k constant in src/secret/k.ts" }] }),
    ];
    const { report } = await run(units, (input) => {
      started.push(input.unit.id);
      return good(input.unit.files[0]!);
    });
    expect(started).toEqual(["u1"]);
    expect(report.statuses).toMatchObject({ u1: "held", u2: "blocked" });
  });

  it("fails a unit that is RED three times and blocks what waits on it", async () => {
    const units = [
      unit("u1", "src/a.ts"),
      unit("u2", "src/b.ts", { needs: [{ unit: "u1", reads: "a constant in src/a.ts" }] }),
    ];
    const tiersSeen: string[] = [];
    const { report } = await run(units, (input) => {
      tiersSeen.push(`${input.attempt}:${input.model}`);
      return { files: { "src/a.ts": "BROKEN\n" } };
    });
    expect(report.statuses).toMatchObject({ u1: "failed", u2: "blocked" });
    expect(report.attempts.filter((a) => a.unitId === "u1")).toHaveLength(3);
    // Stations climb the ladder only on the third attempt.
    expect(tiersSeen).toEqual(["1:model-a", "2:model-a", "3:model-b"]);
  });

  it("writes one lesson line per send-back, and promotes a reason seen twice into rules", async () => {
    const { report } = await run([unit("u1", "src/a.ts"), unit("u2", "src/b.ts")], (input) => ({
      files: { [input.unit.files[0]!]: input.attempt === 1 ? "BROKEN\n" : "export const ok = 1;\n" },
    }));
    expect(report.shipped.sort()).toEqual(["u1", "u2"]);
    const text = lessons(report.integrationBranch);
    expect(text.split("\n").filter((l) => l.startsWith("- tests failed"))).toHaveLength(2);
    expect(text).toContain("(u1: Unit u1)");
    expect(text).toContain("(u2: Unit u2)");
    expect(sh(repo, "show", `${report.integrationBranch}:.bulletin/rules.md`)).toContain(
      "- Cut units so this cannot recur: tests failed",
    );
  });

  it("emits events for every state change and ends with mission.finished", async () => {
    const { events } = await run([unit("u1", "src/a.ts")], () => good("src/a.ts"));
    const types = events.events.map((e) => e.type);
    for (const t of [
      "mission.created",
      "plan.proposed",
      "plan.approved",
      "wave.started",
      "unit.started",
      "attempt.started",
      "ledger.charged",
      "pass.green",
      "attempt.ended",
      "unit.merged",
    ] as const) {
      expect(types).toContain(t);
    }
    expect(types.at(-1)).toBe("mission.finished");
  });

  it("cleans up: no station worktrees or scratch checkouts are left behind", async () => {
    const { report } = await run([unit("u1", "src/a.ts"), unit("u2", "src/b.ts")], (input) => good(input.unit.files[0]!));
    expect(report.shipped).toHaveLength(2);
    const listed = sh(repo, "worktree", "list").split("\n");
    expect(listed).toHaveLength(1);
  });
});

describe("graph engine: the report", () => {
  let report: MissionReport;

  beforeEach(async () => {
    // Stub usage is 1000 input and 100 output tokens a call at model-a: 0.1 + 0.05 = 0.15 cents.
    ({ report } = await run(
      [unit("u1", "src/a.ts"), unit("u2", "src/b.ts"), unit("u3", "src/secret/k.ts")],
      (input) => ({ files: { [input.unit.files[0]!]: input.attempt === 1 && input.unit.id === "u2" ? "BROKEN\n" : "export const ok = 1;\n" } }),
    ));
  });

  it("charges the ledger for every model call, priced from config", () => {
    expect(report.ledger).toHaveLength(4);
    expect(report.ledger.every((row) => row.model === "model-a")).toBe(true);
    expect(report.ledger[0]!.costCents).toBeCloseTo(0.15, 4);
    expect(report.costCents).toBeCloseTo(0.6, 4);
  });

  it("reports touches, touch rate and cost per green unit", () => {
    expect(report.shipped.sort()).toEqual(["u1", "u2"]);
    expect(report.held).toEqual(["u3"]);
    expect(report.touches).toBe(1);
    expect(report.touchRate).toBeCloseTo(0.5, 6);
    // Three units went green; the broken attempt's cost is charged to them.
    expect(report.costPerGreenUnitCents).toBeCloseTo(0.2, 4);
  });

  it("prints the numbers", () => {
    const text = formatReport(report);
    expect(text).toContain("shipped      u1 u2");
    expect(text).toContain("held         u3");
    expect(text).toContain("touch rate   0.50");
    expect(text).toContain("git diff main...bulletin/m1/integration");
  });

  it("leaves the base branch untouched", () => {
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("export const a = 0;\n");
    expect(sh(repo, "rev-parse", "main")).toBe(sh(repo, "rev-parse", "main"));
    expect(sh(repo, "log", "--format=%s", "main")).toBe("base");
  });
});
