import { expect, it } from "vitest";
import { checkEnvironment, type EnvCheckDeps } from "./env-check";

type Tools = Record<string, { path?: string; code?: number | null; stdout?: string; timedOut?: boolean }>;

/** Fake PATH and process runner: `tools` says which programs exist and what `<tool> <args>` prints. */
function deps(env: NodeJS.Dict<string>, tools: Tools): EnvCheckDeps & { ran: string[] } {
  const ran: string[] = [];
  return {
    env,
    ran,
    resolve: (name) => tools[name]?.path,
    run: async (executable, args) => {
      const name = Object.keys(tools).find((key) => tools[key]?.path === executable)!;
      ran.push(`${name} ${args.join(" ")}`);
      const tool = tools[name]!;
      return { code: "code" in tool ? (tool.code as number | null) : 0, stdout: tool.stdout ?? "", timedOut: tool.timedOut ?? false, truncated: false };
    },
  };
}

const GIT = { path: "C:/git/git.exe", stdout: "git version 2.51.0.windows.1\n" };
const CLAUDE_IN = { path: "C:/bin/claude.exe", stdout: JSON.stringify({ loggedIn: true, email: "someone@example.com", orgId: "org-secret" }) };

it("reports git and the Claude Code login, and returns only the documented flags", async () => {
  const result = await checkEnvironment(deps({}, { git: GIT, claude: CLAUDE_IN }));
  expect(result).toEqual({
    git: { found: true, version: "git version 2.51.0.windows.1" },
    claude: { found: true, logged_in: true },
    provider: { id: "claude-code", ready: true, env: {} },
  });
  expect(JSON.stringify(result)).not.toMatch(/someone@example|org-secret/);
});

it("reports missing programs without running them", async () => {
  const d = deps({}, {});
  expect(await checkEnvironment(d)).toEqual({
    git: { found: false, version: null },
    claude: { found: false, logged_in: false },
    provider: { id: "claude-code", ready: false, env: {} },
  });
  expect(d.ran).toEqual([]);
});

it.each([
  ["logged out JSON", { ...CLAUDE_IN, stdout: '{"loggedIn": false}', code: 1 }, false],
  ["JSON flag wins over the exit code", { ...CLAUDE_IN, stdout: '{"loggedIn": true}', code: 1 }, true],
  ["text output that exits 0", { ...CLAUDE_IN, stdout: "Logged in as someone", code: 0 }, true],
  ["text output that exits 1", { ...CLAUDE_IN, stdout: "Not logged in", code: 1 }, false],
  ["a run that could not start", { ...CLAUDE_IN, stdout: "", code: null }, false],
  ["a run that timed out", { ...CLAUDE_IN, stdout: '{"loggedIn": true}', code: null, timedOut: true }, false],
])("reads claude login from %s", async (_name, claude, loggedIn) => {
  const result = await checkEnvironment(deps({}, { git: GIT, claude }));
  expect(result.claude).toEqual({ found: true, logged_in: loggedIn });
});

it("asks the Claude Code CLI for its auth status", async () => {
  const d = deps({}, { git: GIT, claude: CLAUDE_IN });
  await checkEnvironment(d);
  expect(d.ran).toEqual(["git --version", "claude auth status"]);
});

it("maps BULLETIN_PROVIDER to the desktop's provider names and lists which variable names are set, never values", async () => {
  const anthropic = await checkEnvironment(deps({ BULLETIN_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-very-secret" }, { git: GIT }));
  expect(anthropic.provider).toEqual({ id: "anthropic-key", ready: true, env: { ANTHROPIC_API_KEY: true } });
  expect(JSON.stringify(anthropic)).not.toContain("sk-ant-very-secret");

  const missing = await checkEnvironment(deps({ BULLETIN_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "  " }, { git: GIT }));
  expect(missing.provider).toEqual({ id: "anthropic-key", ready: false, env: { ANTHROPIC_API_KEY: false } });

  const bedrock = await checkEnvironment(deps({ BULLETIN_PROVIDER: "bedrock", AWS_REGION: "us-east-1", AWS_BEARER_TOKEN_BEDROCK: "bearer-secret" }, { git: GIT }));
  expect(bedrock.provider).toEqual({
    id: "bedrock",
    ready: true,
    env: { AWS_REGION: true, AWS_BEARER_TOKEN_BEDROCK: true, AWS_ACCESS_KEY_ID: false, AWS_PROFILE: false },
  });
  expect(JSON.stringify(bedrock)).not.toContain("bearer-secret");

  const noRegion = await checkEnvironment(deps({ BULLETIN_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "x" }, { git: GIT }));
  expect(noRegion.provider.ready).toBe(false);

  const unknown = await checkEnvironment(deps({ BULLETIN_PROVIDER: "other" }, { git: GIT }));
  expect(unknown.provider).toEqual({ id: null, ready: false, env: {} });
});

it("claude-code is ready only with the CLI found and logged in", async () => {
  expect((await checkEnvironment(deps({}, { git: GIT, claude: { ...CLAUDE_IN, stdout: '{"loggedIn": false}', code: 1 } }))).provider.ready).toBe(false);
});
