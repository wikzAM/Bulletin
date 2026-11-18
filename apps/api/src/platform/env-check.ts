import { missingCredentialNames } from "@bulletin/models";
import { resolveExecutable, runTool, type ToolResult } from "./executables";

/** The provider names the desktop uses. `null` means BULLETIN_PROVIDER is set to something unknown. */
export type DesktopProvider = "claude-code" | "anthropic-key" | "bedrock";

export interface EnvCheckResult {
  git: { found: boolean; version: string | null };
  claude: { found: boolean; logged_in: boolean };
  provider: { id: DesktopProvider | null; ready: boolean; env: Record<string, boolean> };
}

export interface EnvCheckDeps {
  env: NodeJS.Dict<string>;
  resolve?: (name: string) => string | undefined;
  run?: (executable: string, args: readonly string[]) => Promise<ToolResult>;
}

const AUTH_TIMEOUT_MS = 15_000;
const VERSION_TIMEOUT_MS = 10_000;

/** The environment variables each provider reads (names only; see packages/models missingCredentialNames). */
const PROVIDER_ENV: Record<DesktopProvider, readonly string[]> = {
  "claude-code": [],
  "anthropic-key": ["ANTHROPIC_API_KEY"],
  bedrock: ["AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID", "AWS_PROFILE"],
};

function providerId(env: NodeJS.Dict<string>): DesktopProvider | null {
  const chosen = env.BULLETIN_PROVIDER?.trim();
  if (!chosen) return "claude-code";
  if (chosen === "anthropic") return "anthropic-key";
  if (chosen === "bedrock") return "bedrock";
  return null;
}

/** Only the `loggedIn` flag is read; the rest of `claude auth status` (account, email, organization) is dropped. */
function loggedIn(result: ToolResult): boolean {
  if (result.timedOut || result.code === null) return false;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { loggedIn?: unknown }).loggedIn === "boolean") {
      return (parsed as { loggedIn: boolean }).loggedIn;
    }
  } catch {
    // Not JSON: fall back to the exit code.
  }
  return result.code === 0;
}

export async function checkEnvironment(deps: EnvCheckDeps): Promise<EnvCheckResult> {
  const env = deps.env;
  const resolve = deps.resolve ?? ((name: string) => resolveExecutable(name, env));
  const run = deps.run ?? ((executable: string, args: readonly string[]) => runTool(executable, args, { cwd: process.cwd(), env, timeoutMs: args[0] === "auth" ? AUTH_TIMEOUT_MS : VERSION_TIMEOUT_MS }));

  const gitPath = resolve("git");
  let gitVersion: string | null = null;
  if (gitPath) {
    const result = await run(gitPath, ["--version"]);
    gitVersion = result.code === 0 ? (result.stdout.split(/\r?\n/)[0]?.trim() || null) : null;
  }

  const claudePath = resolve("claude");
  const claudeLoggedIn = claudePath ? loggedIn(await run(claudePath, ["auth", "status"])) : false;

  const id = providerId(env);
  const has = (name: string) => Boolean(env[name]?.trim());
  const names = id === null ? [] : PROVIDER_ENV[id];
  const envFlags = Object.fromEntries(names.map((name) => [name, has(name)]));
  let ready = false;
  if (id === "claude-code") ready = claudePath !== undefined && claudeLoggedIn;
  else if (id !== null) ready = missingCredentialNames(id === "bedrock" ? "bedrock" : "anthropic", has).length === 0;

  return {
    git: { found: gitPath !== undefined, version: gitVersion },
    claude: { found: claudePath !== undefined, logged_in: claudeLoggedIn },
    provider: { id, ready, env: envFlags },
  };
}
