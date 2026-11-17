import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { git } from "@bulletin/runners/git";
import { ManagedAgentsRunner } from "@bulletin/runners/managed-agents-runner";
import { sdkManagedClient } from "./managed-client";

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
