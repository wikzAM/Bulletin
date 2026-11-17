import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadModelsConfig, loadPricesConfig } from "@bulletin/core";
import { ClaudeCodeRunner } from "@bulletin/runners/claude-code-runner";
import { git } from "@bulletin/runners/git";
import { formatReport, runMission } from "./orchestrator/run-mission";

/** bulletin run --repo <path> --plan <plan.json> [--base main] [--test "pnpm test"] */
async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string, fallback?: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : fallback;
  };
  if (cmd !== "run" || !flag("repo") || !flag("plan")) {
    console.error('usage: bulletin run --repo <path> --plan <plan.json> [--base main] [--test "pnpm test"]');
    process.exit(2);
  }
  const repo = resolve(flag("repo")!);
  const root = resolve(import.meta.dirname, "../../..");
  const models = loadModelsConfig(resolve(root, "config/models.json"));
  const prices = loadPricesConfig(resolve(root, "config/prices.json"));
  const plan = JSON.parse(readFileSync(resolve(flag("plan")!), "utf8"));
  const base = flag("base") ?? (await git(repo, "rev-parse", "--abbrev-ref", "HEAD"));
  const missionId = `m${Date.now().toString(36)}`;
  const scratchDir = resolve(repo, "..", ".bulletin-scratch", missionId);
  const events = {
    emit: async (e: { type: string; unit_id?: string | null; payload?: Record<string, unknown> }) => {
      if (e.type === "pass.red") console.log(`[pass.red] ${e.unit_id} ${JSON.stringify(e.payload).slice(0, 400)}`);
      else
      console.log(`[${e.type}]${e.unit_id ? ` ${e.unit_id}` : ""}`);
    },
  };
  const report = await runMission({
    missionId,
    repo,
    scratchDir,
    baseBranch: base,
    plan,
    runner: new ClaudeCodeRunner(repo, scratchDir),
    prices,
    tiers: models.tiers,
    testCommand: flag("test"),
    unitAllowanceCents: Number(flag("allowance", "200")),
    allowedCommands: ["pnpm *", "npm *", "node *"],
    events: events as never,
  });
  console.log(formatReport(report));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
