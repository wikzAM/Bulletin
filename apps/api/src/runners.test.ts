import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelClient, ModelResponse } from "@bulletin/models";
import type { RunnerEvent } from "@bulletin/runners";
import { cliRunner, sdkRunner } from "./runners";

// Real git; the default 5s is too tight on a loaded Windows machine.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const root = resolve(import.meta.dirname, "../../..");
let work: string;
let repo: string;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "bulletin-sdkrunner-"));
  repo = join(work, "repo");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "test");
  sh(repo, "config", "user.email", "test@example.com");
  writeFileSync(join(repo, "README.md"), "hi\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "init");
});
afterEach(() => {
  try {
    sh(repo, "worktree", "prune");
  } catch {
    /* gone */
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const finish: ModelResponse = {
  stop_reason: "end_turn",
  content: [{ type: "text", text: "done" }],
  usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
};
const fakeClient = (provider: "anthropic" | "bedrock" = "bedrock"): ModelClient => ({ provider, complete: async () => finish });

describe("sdkRunner", () => {
  it("builds a station runner around the injected model client", async () => {
    const runner = await sdkRunner(repo, join(work, "scratch"), root, { client: fakeClient() });
    expect(runner.kind).toBe("sdk-station");
  });

  it("prices usage from config/prices.json and reports the client's provider", async () => {
    const runner = await sdkRunner(repo, join(work, "scratch"), root, { client: fakeClient("bedrock") });
    const unit = { id: "u1", title: "t", task: "t", files: ["README.md"], acceptance: [], needs: [], lane: "open", tier: "station" };
    const handle = await runner.startAttempt({
      missionId: "m1", unit: unit as never, attempt: 1, baseBranch: "main", briefingSlice: "", rules: "",
      model: "claude-sonnet-5-5", allowanceCents: 0,
    });
    const events: RunnerEvent[] = [];
    for await (const e of runner.events(handle)) events.push(e);
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ provider: "bedrock", model: "claude-sonnet-5-5" });
    // One million uncached input tokens cost the model's configured input price (dollars) in cents.
    const prices = JSON.parse((await import("node:fs")).readFileSync(join(root, "config/prices.json"), "utf8"));
    expect(usage && usage.type === "usage" ? usage.costCents : undefined).toBeCloseTo(prices.models["claude-sonnet-5-5"].input * 100, 4);
  });

  it("refuses bedrock without a region before any call, naming the variable and no value", async () => {
    await expect(sdkRunner(repo, join(work, "scratch"), root, { env: { BULLETIN_PROVIDER: "bedrock" } })).rejects.toThrow(/AWS_REGION/);
  });
});

describe("cliRunner", () => {
  it("picks the station runner for --runner sdk", async () => {
    const runner = await cliRunner("sdk", { repo, scratchDir: join(work, "s"), root, sdk: { client: fakeClient() } });
    expect(runner.kind).toBe("sdk-station");
  });

  it("keeps Claude Code as the default and for an explicit claude", async () => {
    expect((await cliRunner(undefined, { repo, scratchDir: join(work, "s"), root })).kind).toBe("local-claude-code");
    expect((await cliRunner("claude", { repo, scratchDir: join(work, "s"), root })).kind).toBe("local-claude-code");
  });

  it("rejects a runner name it does not know", async () => {
    await expect(cliRunner("nope", { repo, scratchDir: join(work, "s"), root })).rejects.toThrow(/claude, managed or sdk/);
  });
});
