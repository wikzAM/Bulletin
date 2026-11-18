import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryEventLog, type PricesConfig } from "@bulletin/core";
import type { AttemptHandle, AttemptInput, Runner, RunnerEvent } from "@bulletin/runners";
import { StubRunner } from "@bulletin/runners/stub-runner";
import { runMission } from "./run-mission";

// Real git; the default 5s is too tight on a loaded Windows machine.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const prices: PricesConfig = {
  currency: "USD",
  unit: "per_million_tokens",
  as_of: "test",
  models: { "model-a": { input: 1, output: 5, cache_write: 1, cache_read: 0.1 } },
};

let root: string;
let repo: string;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const put = (path: string, contents: string) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bulletin-provider-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "test");
  sh(repo, "config", "user.email", "test@example.com");
  sh(repo, "config", "core.autocrlf", "false");
  put("check.mjs", 'console.log("check ok");\n');
  put("src/a.ts", "export const a = 0;\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
});
afterEach(() => {
  try {
    sh(repo, "worktree", "prune");
  } catch {
    /* gone already */
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const plan = { briefing_version: 1, units: [{ id: "a", title: "A", task: "Write src/a.ts", files: ["src/a.ts"] }] };
const script = () => ({ files: { "src/a.ts": "export const a = 1;\n" } });

/** Passes every event through, minus the provider field, like a runner written before providers existed. */
class OldRunner implements Runner {
  readonly kind = "stub" as const;
  constructor(private readonly inner: StubRunner) {}
  startAttempt(input: AttemptInput): Promise<AttemptHandle> {
    return this.inner.startAttempt(input);
  }
  async *events(handle: AttemptHandle): AsyncIterable<RunnerEvent> {
    for await (const event of this.inner.events(handle)) {
      if (event.type === "usage") {
        const { provider: _provider, ...rest } = event;
        yield rest;
      } else yield event;
    }
  }
  cancel(handle: AttemptHandle) {
    return this.inner.cancel(handle);
  }
}

function run(runner: Runner) {
  const events = new MemoryEventLog();
  return runMission({
    missionId: "m1",
    repo,
    scratchDir: join(root, "scratch"),
    baseBranch: "main",
    plan,
    runner,
    prices,
    tiers: { station: "model-a" },
    testCommand: "node check.mjs",
    allowedCommands: ["node *"],
    events,
  }).then((result) => ({ result, events }));
}

describe("provider on the ledger", () => {
  it("records the runner's provider on every ledger row and in the ledger.charged payload", async () => {
    const stub = new StubRunner(repo, join(root, "stations"), () => ({ ...script(), provider: "bedrock" }));
    const { result, events } = await run(stub);
    expect(result.ledger.length).toBeGreaterThan(0);
    expect(result.ledger.every((row) => row.provider === "bedrock")).toBe(true);
    const charged = events.events.filter((e) => e.type === "ledger.charged");
    expect(charged.length).toBe(result.ledger.length);
    for (const e of charged) expect(e.payload).toMatchObject({ provider: "bedrock", model: "model-a" });
  });

  it("falls back to 'unknown' for a runner that does not say, rather than guessing", async () => {
    const stub = new StubRunner(repo, join(root, "stations"), script);
    const { result, events } = await run(new OldRunner(stub));
    expect(result.ledger.every((row) => row.provider === "unknown")).toBe(true);
    const charged = events.events.filter((e) => e.type === "ledger.charged");
    for (const e of charged) expect(e.payload.provider).toBe("unknown");
  });

  it("keeps the existing payload fields", async () => {
    const stub = new StubRunner(repo, join(root, "stations"), script);
    const { events } = await run(stub);
    const charged = events.events.find((e) => e.type === "ledger.charged")!;
    expect(Object.keys(charged.payload).sort()).toEqual(["attempt", "cost_cents", "model", "provider"]);
  });
});
