import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LANES, loadModelsConfig, loadPricesConfig } from "@bulletin/core";
import { ClaudeCodeRunner } from "@bulletin/runners/claude-code-runner";
import { git } from "@bulletin/runners/git";
import { ManagedAgentsRunner } from "@bulletin/runners/managed-agents-runner";
import Anthropic from "@anthropic-ai/sdk";
import { sdkManagedClient } from "./managed-client";
import { claudeModelCall, runGeneral, withFallback } from "./general";
import { formatReport, runMission } from "./orchestrator/run-mission";

/** bulletin run --repo <path> --plan <plan.json> [--base main] [--test "pnpm test"] */
async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string, fallback?: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : fallback;
  };
  if (cmd === "plan" && flag("repo") && flag("goal")) {
    const repo = resolve(flag("repo")!);
    const root = resolve(import.meta.dirname, "../../..");
    const models = loadModelsConfig(resolve(root, "config/models.json"));
    const model = models.roles.general?.model ?? "claude-opus-5-5";
    const fallback = models.roles.general?.fallback ?? "claude-opus-5-5";
    const repoFiles = (await git(repo, "ls-files")).split("\n").filter(Boolean);
    const result = await runGeneral(
      {
        briefing: flag("goal")!,
        repoMap: repoFiles.join("\n"),
        rules: "",
        lessons: "",
        validation: { repoFiles, lanes: DEFAULT_LANES, allowedCommands: ["pnpm *", "npm *", "node *"] },
      },
      withFallback(claudeModelCall(model, "claude", repo), claudeModelCall(fallback, "claude", repo), (why) =>
        console.error(`[general] ${model} unavailable (${why.slice(0, 120)}); using ${fallback}`),
      ),
    );
    if (!result.ok) {
      console.error(`The General could not produce a valid plan after ${result.attempts} tries:\n${result.errors.join("\n")}`);
      process.exit(1);
    }
    const out = resolve(flag("out", "plan.json")!);
    writeFileSync(out, JSON.stringify(result.plan, null, 2));
    console.log(`plan written to ${out} (${result.plan.units.length} units, ${result.attempts} tries, model ${model})`);
    return;
  }
  if (cmd !== "run" || !flag("repo") || !flag("plan")) {
    console.error('usage: bulletin plan --repo <path> --goal "text" [--out plan.json]\n       bulletin run --repo <path> --plan <plan.json> [--base main] [--test "pnpm test"]');
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
    runner: flag("runner") === "managed" ? managedRunner(repo, root, flag("sandbox-repo")) : new ClaudeCodeRunner(repo, scratchDir),
    prices,
    tiers: models.tiers,
    testCommand: flag("test"),
    unitAllowanceCents: Number(flag("allowance", "200")),
    allowedCommands: ["pnpm *", "npm *", "node *"],
    events: events as never,
  });
  console.log(formatReport(report));
}

/**
 * Cloud stations. `repo` must be a clone of the scratch GitHub repository (origin), because the
 * sandbox clones origin and pushes back to it. Keys come from the shell: ANTHROPIC_API_KEY,
 * BULLETIN_GITHUB_TOKEN. The agent and environment ids come from .bulletin-local.json (ma-setup).
 */
function managedRunner(repo: string, root: string, sandboxRepo?: string): ManagedAgentsRunner {
  const localFile = resolve(root, ".bulletin-local.json");
  const ids = existsSync(localFile) ? JSON.parse(readFileSync(localFile, "utf8")) : {};
  const agentId = process.env.BULLETIN_MA_AGENT_ID ?? ids.agentId;
  const environmentId = process.env.BULLETIN_MA_ENV_ID ?? ids.environmentId;
  const githubToken = process.env.BULLETIN_GITHUB_TOKEN;
  if (!process.env.ANTHROPIC_API_KEY || !githubToken || !agentId || !environmentId || !sandboxRepo) {
    throw new Error(
      "managed runner needs ANTHROPIC_API_KEY, BULLETIN_GITHUB_TOKEN, --sandbox-repo <github url>, and agent/env ids (run apps/api/scripts/ma-setup.ts)",
    );
  }
  const client = sdkManagedClient(new Anthropic().beta.sessions, { agentId, environmentId, repoUrl: sandboxRepo, githubToken });
  return new ManagedAgentsRunner(
    client,
    async (branch) => void (await git(repo, "fetch", "origin", `+${branch}:${branch}`)),
    async (input) => void (await git(repo, "push", "-f", "origin", `${input.baseBranch}:${input.baseBranch}`)),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
