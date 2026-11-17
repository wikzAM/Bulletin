import type { Runner } from "@bulletin/runners";
import { ClaudeCodeRunner } from "@bulletin/runners/claude-code-runner";
import { managedRunner } from "../runners";

interface RunnerEnvironment {
  BULLETIN_RUNNER?: string;
  BULLETIN_SANDBOX_REPO?: string;
}

export function createRunnerFactory(env: RunnerEnvironment, root: string): (repo: string, scratchDir: string) => Runner {
  switch (env.BULLETIN_RUNNER ?? "claude") {
    case "claude":
      return (repo, scratchDir) => new ClaudeCodeRunner(repo, scratchDir);
    case "managed": {
      const sandboxRepo = env.BULLETIN_SANDBOX_REPO?.trim();
      if (!sandboxRepo) throw new Error("BULLETIN_SANDBOX_REPO is required for the managed runner");
      return (repo) => managedRunner(repo, root, sandboxRepo);
    }
    default:
      throw new Error("BULLETIN_RUNNER must be claude or managed");
  }
}
