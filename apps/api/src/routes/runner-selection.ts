import type { Runner } from "@bulletin/runners";

interface RunnerEnvironment {
  BULLETIN_RUNNER?: string;
  BULLETIN_SANDBOX_REPO?: string;
}

export function missingManagedVariableNames(configured: (name: string) => boolean, hasLocalIds: boolean): string[] {
  const names = ["BULLETIN_SANDBOX_REPO", "ANTHROPIC_API_KEY", "BULLETIN_GITHUB_TOKEN"];
  if (!hasLocalIds) names.push("BULLETIN_MA_AGENT_ID", "BULLETIN_MA_ENV_ID");
  return names.filter((name) => !configured(name));
}

export function createRunnerFactory(env: RunnerEnvironment, root: string): (repo: string, scratchDir: string) => Promise<Runner> {
  switch (env.BULLETIN_RUNNER ?? "claude") {
    case "claude":
      return async (repo, scratchDir) => {
        const { ClaudeCodeRunner } = await import("@bulletin/runners/claude-code-runner");
        return new ClaudeCodeRunner(repo, scratchDir);
      };
    case "managed": {
      const sandboxRepo = env.BULLETIN_SANDBOX_REPO?.trim();
      if (!sandboxRepo) throw new Error("BULLETIN_SANDBOX_REPO is required for the managed runner");
      return async (repo) => {
        const { managedRunner } = await import("../runners");
        return managedRunner(repo, root, sandboxRepo);
      };
    }
    default:
      throw new Error("BULLETIN_RUNNER must be claude or managed");
  }
}
