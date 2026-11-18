import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadModelsConfig, loadPricesConfig } from "@bulletin/core";
import type { ModelClient } from "@bulletin/models";
import type { Runner } from "@bulletin/runners";
import { SdkStationRunner, type SdkStationRunnerOptions } from "@bulletin/runners/sdk-station-runner";
import { git } from "@bulletin/runners/git";
import { ManagedAgentsRunner } from "@bulletin/runners/managed-agents-runner";
import { sdkManagedClient } from "./managed-client";
import { allowedLocalCommands } from "./routes/mission-planning";
import { costCents } from "./treasury/treasury";

/**
 * Cloud stations. `repo` must be a clone of the scratch GitHub repository (origin), because the
 * sandbox clones origin and pushes back to it. Keys come from the shell: ANTHROPIC_API_KEY,
 * BULLETIN_GITHUB_TOKEN. The agent and environment ids come from .bulletin-local.json (ma-setup).
 */
export function managedRunner(repo: string, root: string, sandboxRepo?: string): ManagedAgentsRunner {
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
  const pushed = new Map<string, Promise<void>>();
  const client = sdkManagedClient(new Anthropic().beta.sessions, { agentId, environmentId, repoUrl: sandboxRepo, githubToken });
  return new ManagedAgentsRunner(
    client,
    async (branch) => void (await git(repo, "fetch", "origin", `+${branch}:${branch}`)),
    async (input) => {
      // Stations of one wave start together and share a base: push each branch version once.
      const sha = await git(repo, "rev-parse", input.baseBranch);
      const key = `${input.baseBranch}@${sha}`;
      let push = pushed.get(key);
      if (!push) {
        push = git(repo, "push", "-f", "origin", `${input.baseBranch}:${input.baseBranch}`).then(() => undefined);
        pushed.set(key, push);
        push.catch(() => pushed.delete(key));
      }
      await push;
    },
  );
}

export interface SdkRunnerDeps {
  /** Injected in tests. Without it the client for BULLETIN_PROVIDER is built from the environment. */
  client?: ModelClient;
  env?: Readonly<Record<string, string | undefined>>;
  /** Extra tools per attempt, such as the Bulletin tools (`createStationTools` in @bulletin/bulletin-mcp). */
  stationTools?: SdkStationRunnerOptions["stationTools"];
}

/**
 * Stations that run inside the sidecar: a Messages API tool loop against the provider chosen by
 * BULLETIN_PROVIDER (anthropic or bedrock). Credentials are read by the SDKs from their own environment
 * variables; nothing here sees them. Usage is priced from config/prices.json.
 */
export async function sdkRunner(repo: string, scratchDir: string, root: string, deps: SdkRunnerDeps = {}): Promise<SdkStationRunner> {
  const models = loadModelsConfig(resolve(root, "config/models.json"));
  const prices = loadPricesConfig(resolve(root, "config/prices.json"));
  // Loaded on demand: it pulls in both provider SDKs, which a Claude Code or managed run never needs.
  const client = deps.client ?? (await import("@bulletin/models/real")).createRealModelClient(deps.env ?? process.env, models.providers?.bedrock?.models);
  return new SdkStationRunner({
    repo,
    scratchDir,
    model: client,
    allowedCommands: allowedLocalCommands,
    costOf: (model, usage) => costCents(model, usage, prices),
    ...(deps.stationTools ? { stationTools: deps.stationTools } : {}),
  });
}

/** The runner behind `bulletin run --runner <name>`. */
export async function cliRunner(
  name: string | undefined,
  ctx: { repo: string; scratchDir: string; root: string; sandboxRepo?: string; sdk?: SdkRunnerDeps },
): Promise<Runner> {
  switch (name ?? "claude") {
    case "claude": {
      const { ClaudeCodeRunner } = await import("@bulletin/runners/claude-code-runner");
      return new ClaudeCodeRunner(ctx.repo, ctx.scratchDir);
    }
    case "managed":
      return managedRunner(ctx.repo, ctx.root, ctx.sandboxRepo);
    case "sdk":
      return sdkRunner(ctx.repo, ctx.scratchDir, ctx.root, ctx.sdk);
    default:
      throw new Error("--runner must be claude, managed or sdk");
  }
}
