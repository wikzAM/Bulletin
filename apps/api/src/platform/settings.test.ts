import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SettingsError, SettingsStore } from "./settings";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bulletin-settings-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

it("starts empty and keeps what was set across instances, in settings.json in the data folder", async () => {
  const store = new SettingsStore(directory);
  expect(await store.get()).toEqual({});
  expect(await store.set({ provider: "bedrock", repo_path: "D:\\work\\demo", setup_complete: true })).toEqual({
    provider: "bedrock",
    repo_path: "D:\\work\\demo",
    setup_complete: true,
  });
  expect(await new SettingsStore(directory).get()).toEqual({ provider: "bedrock", repo_path: "D:\\work\\demo", setup_complete: true });
  expect(JSON.parse(await readFile(join(directory, "settings.json"), "utf8"))).toEqual({ provider: "bedrock", repo_path: "D:\\work\\demo", setup_complete: true });
});

it("keeps an AWS region such as us-east-1 for Bedrock", async () => {
  const store = new SettingsStore(directory);
  expect(await store.set({ aws_region: "us-east-1" })).toEqual({ aws_region: "us-east-1" });
  expect(await store.set({ aws_region: "us-gov-west-1" })).toEqual({ aws_region: "us-gov-west-1" });
  expect(await store.set({ aws_region: null })).toEqual({});
});

it("merges changes, and null removes a key", async () => {
  const store = new SettingsStore(directory);
  await store.set({ provider: "claude-code", repo_path: "D:\\a" });
  expect(await store.set({ repo_path: "D:\\b" })).toEqual({ provider: "claude-code", repo_path: "D:\\b" });
  expect(await store.set({ provider: null })).toEqual({ repo_path: "D:\\b" });
  expect(await store.set({})).toEqual({ repo_path: "D:\\b" });
});

it("rejects unknown keys and bad values without changing anything, so a secret cannot be saved here", async () => {
  const store = new SettingsStore(directory);
  await store.set({ provider: "claude-code" });
  for (const values of [
    { ANTHROPIC_API_KEY: "sk-ant-secret" },
    { api_key: "x" },
    { provider: "openai" },
    { provider: 3 },
    { repo_path: 5 },
    { repo_path: "x".repeat(1025) },
    { repo_path: "a\0b" },
    { setup_complete: "yes" },
    { aws_region: "us east 1" },
    { aws_region: "../evil" },
    { provider: "bedrock", ANTHROPIC_API_KEY: "sk-ant-secret" },
  ]) {
    await expect(store.set(values as Record<string, unknown>)).rejects.toBeInstanceOf(SettingsError);
  }
  expect(await store.get()).toEqual({ provider: "claude-code" });
  expect(await readFile(join(directory, "settings.json"), "utf8")).not.toContain("sk-ant-secret");
});

it("does not echo a rejected value in its error", async () => {
  const store = new SettingsStore(directory);
  await expect(store.set({ ANTHROPIC_API_KEY: "sk-ant-secret" })).rejects.toThrow(/Unknown setting/);
  await expect(store.set({ provider: "sk-ant-secret" })).rejects.not.toThrow(/sk-ant-secret/);
});

it("replaces the file atomically: no temporary file is left behind", async () => {
  const store = new SettingsStore(directory);
  await store.set({ provider: "claude-code" });
  await store.set({ provider: "bedrock" });
  expect(await readdir(directory)).toEqual(["settings.json"]);
});

it("ignores unknown or invalid content already on disk instead of failing", async () => {
  await writeFile(join(directory, "settings.json"), JSON.stringify({ provider: "bedrock", stray: "x", repo_path: 7 }));
  expect(await new SettingsStore(directory).get()).toEqual({ provider: "bedrock" });
  await writeFile(join(directory, "settings.json"), "{ broken");
  expect(await new SettingsStore(directory).get()).toEqual({});
});

it("serializes concurrent changes so none is lost", async () => {
  const store = new SettingsStore(directory);
  await Promise.all([store.set({ provider: "bedrock" }), store.set({ repo_path: "D:\\x" }), store.set({ setup_complete: false })]);
  expect(await store.get()).toEqual({ provider: "bedrock", repo_path: "D:\\x", setup_complete: false });
});

it("validates, persists, and clears the spending defaults", async () => {
  const store = new SettingsStore(directory);
  const limits = { default_budget_cents: 100_000, unit_allowance_cents: 10_000 };
  expect(await store.set(limits)).toEqual(limits);
  for (const values of [
    { default_budget_cents: -1 }, { default_budget_cents: "500" }, { default_budget_cents: 100_001 },
    { unit_allowance_cents: 1.5 }, { unit_allowance_cents: true }, { unit_allowance_cents: 10_001 },
  ]) {
    await expect(store.set(values)).rejects.toBeInstanceOf(SettingsError);
  }
  expect(await new SettingsStore(directory).get()).toEqual(limits);
  expect(await store.set({ default_budget_cents: null, unit_allowance_cents: 0 })).toEqual({ unit_allowance_cents: 0 });
});
