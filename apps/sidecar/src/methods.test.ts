import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EnvKeychain } from "../../api/src/platform/keychain";
import { createDesktopMethods } from "./methods";
import { RpcError } from "./rpc-error";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bulletin-methods-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

function methods(env: NodeJS.Dict<string> = {}) {
  const calls: string[] = [];
  const table = createDesktopMethods({
    dataDirectory: directory,
    keychain: new EnvKeychain(env),
    checkEnvironment: async () => {
      calls.push("env");
      return { git: { found: true, version: "git version 2" }, claude: { found: true, logged_in: true }, provider: { id: "claude-code", ready: true, env: {} } };
    },
    inspectRepo: async (path) => {
      calls.push(`inspect ${path}`);
      return { path, exists: true, is_repo: true, root: path, branch: "main", dirty: false, test_command: null, file_count: 1, file_count_capped: false };
    },
  });
  return { table, calls, env };
}

const rejects = async (promise: Promise<unknown>, code: number, message?: RegExp) => {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(RpcError);
  expect((error as RpcError).code).toBe(code);
  if (message) expect((error as RpcError).message).toMatch(message);
};

it("exposes exactly the desktop methods", () => {
  expect(Object.keys(methods().table).sort()).toEqual(["app.info", "env.check", "repo.inspect", "secret.has", "secret.set", "settings.get", "settings.set"]);
});

it("app.info reports the folder the sidecar keeps its data in", async () => {
  const { table } = methods();
  expect(await table["app.info"]!({})).toEqual({ data_folder: directory });
});

it("env.check returns the environment report", async () => {
  const { table, calls } = methods();
  expect(await table["env.check"]!({})).toMatchObject({ git: { found: true }, provider: { id: "claude-code" } });
  expect(calls).toEqual(["env"]);
});

it("repo.inspect needs an absolute path string and reports a missing folder as a result", async () => {
  const { table, calls } = methods();
  await rejects(table["repo.inspect"]!({}), -32602, /absolute folder path/);
  await rejects(table["repo.inspect"]!({ path: 5 }), -32602);
  await rejects(table["repo.inspect"]!({ path: "relative" }), -32602, /absolute/);
  expect(calls).toEqual([]);
  expect(await table["repo.inspect"]!({ path: join(directory, "x") })).toMatchObject({ exists: true });
  expect(calls).toHaveLength(1);
});

it("settings.get and settings.set round-trip through the data folder and refuse unknown keys with -32602", async () => {
  const { table } = methods();
  expect(await table["settings.get"]!({})).toEqual({ settings: {} });
  expect(await table["settings.set"]!({ values: { provider: "bedrock", setup_complete: true } })).toEqual({ settings: { provider: "bedrock", setup_complete: true } });
  expect(await table["settings.get"]!({})).toEqual({ settings: { provider: "bedrock", setup_complete: true } });
  expect(await table["settings.set"]!({ values: { provider: null } })).toEqual({ settings: { setup_complete: true } });
  await rejects(table["settings.set"]!({ values: { ANTHROPIC_API_KEY: "sk-ant-secret" } }), -32602, /Unknown setting/);
  await rejects(table["settings.set"]!({ values: { provider: "nope" } }), -32602);
  await rejects(table["settings.set"]!({}), -32602, /values/);
  await rejects(table["settings.set"]!({ values: [] }), -32602, /values/);
  await rejects(table["settings.set"]!({ values: "provider" }), -32602, /values/);
});

it("secret.has reports presence by name only", async () => {
  const { table } = methods({ ANTHROPIC_API_KEY: "sk-ant-secret", AWS_BEARER_TOKEN_BEDROCK: "  " });
  expect(await table["secret.has"]!({ name: "ANTHROPIC_API_KEY" })).toEqual({ name: "ANTHROPIC_API_KEY", present: true });
  expect(await table["secret.has"]!({ name: "AWS_BEARER_TOKEN_BEDROCK" })).toEqual({ name: "AWS_BEARER_TOKEN_BEDROCK", present: false });
  expect(await table["secret.has"]!({ name: "BULLETIN_GITHUB_TOKEN" })).toEqual({ name: "BULLETIN_GITHUB_TOKEN", present: false });
});

it("secret.set stores into the running process only and never echoes the value", async () => {
  const { table, env } = methods();
  const result = await table["secret.set"]!({ name: "ANTHROPIC_API_KEY", value: "sk-ant-secret" });
  expect(result).toEqual({ name: "ANTHROPIC_API_KEY", stored: true });
  expect(JSON.stringify(result)).not.toContain("sk-ant-secret");
  expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-secret");
  expect(await table["secret.has"]!({ name: "ANTHROPIC_API_KEY" })).toEqual({ name: "ANTHROPIC_API_KEY", present: true });
});

it("secrets are limited to the known names and sane values, and errors never contain the value", async () => {
  const { table, env } = methods();
  await rejects(table["secret.has"]!({ name: "PATH" }), -32602, /Unknown secret/);
  await rejects(table["secret.has"]!({}), -32602);
  await rejects(table["secret.set"]!({ name: "NODE_OPTIONS", value: "--require evil" }), -32602, /Unknown secret/);
  await rejects(table["secret.set"]!({ name: "ANTHROPIC_API_KEY" }), -32602, /value/);
  await rejects(table["secret.set"]!({ name: "ANTHROPIC_API_KEY", value: "" }), -32602, /value/);
  await rejects(table["secret.set"]!({ name: "ANTHROPIC_API_KEY", value: 5 }), -32602, /value/);
  const bad = table["secret.set"]!({ name: "ANTHROPIC_API_KEY", value: "sk-ant-secret\0x" });
  await rejects(bad, -32602);
  await bad.catch((error: RpcError) => expect(error.message).not.toContain("sk-ant-secret"));
  expect(Object.keys(env)).toEqual([]);
});

it("documents every method the sidecar answers in docs/SIDECAR.md, each under its own heading", async () => {
  const { readFile } = await import("node:fs/promises");
  const docs = await readFile(new URL("../../../docs/SIDECAR.md", import.meta.url), "utf8");
  const headings = [...docs.matchAll(/^## (.+)$/gm)].map((match) => match[1]!);
  for (const name of ["health", "request", "subscribe", "unsubscribe", ...Object.keys(methods().table)]) {
    expect(headings.some((heading) => heading.includes(`\`${name}\``)), name).toBe(true);
  }
});

it("secret.set stores the value without surrounding whitespace", async () => {
  const { table, env } = methods();
  await table["secret.set"]!({ name: "ANTHROPIC_API_KEY", value: "  sk-ant-pasted\n" });
  expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-pasted");
});
