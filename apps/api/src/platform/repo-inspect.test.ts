import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectRepo as inspect, type InspectOptions } from "./repo-inspect";

// git is slow to start on a loaded Windows host, and several tests start it a few times each.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

let directory: string;
let options: InspectOptions;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "bulletin-inspect-")));
  // The temp folder may itself sit inside someone's repository (a home folder under git); do not look above it.
  options = { env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(directory) } };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const inspectRepo = (path: string, extra: InspectOptions = {}) => inspect(path, { ...options, ...extra });

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    env: options.env as NodeJS.ProcessEnv,
  });

async function folder(name: string, files: Record<string, string> = {}): Promise<string> {
  const path = join(directory, name);
  await mkdir(path);
  for (const [file, text] of Object.entries(files)) await writeFile(join(path, file), text);
  return path;
}

async function repo(name: string, files: Record<string, string> = { "a.txt": "a" }): Promise<string> {
  const path = await folder(name, files);
  git(path, "init", "-q", "-b", "main");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "first");
  return path;
}

const KEYS = ["path", "exists", "is_repo", "root", "branch", "dirty", "test_command", "file_count", "file_count_capped"];

it("describes a repository: branch, root, file count, the test script, and what changes make it dirty", async () => {
  const path = await repo("one", { "a.txt": "a", "b.txt": "b", "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
  const clean = await inspectRepo(path);
  expect(Object.keys(clean).sort()).toEqual([...KEYS].sort());
  expect(clean).toMatchObject({ path, exists: true, is_repo: true, branch: "main", dirty: false, test_command: "npm test", file_count: 3, file_count_capped: false });
  expect(clean.root?.replace(/\\/g, "/").toLowerCase()).toBe(path.replace(/\\/g, "/").toLowerCase());

  await writeFile(join(path, "new.txt"), "untracked");
  expect((await inspectRepo(path)).dirty).toBe(true);
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "second");
  expect(await inspectRepo(path)).toMatchObject({ dirty: false, file_count: 4 });
  await writeFile(join(path, "a.txt"), "changed");
  expect((await inspectRepo(path)).dirty).toBe(true);

  git(path, "checkout", "-q", "-f", "--detach");
  expect(await inspectRepo(path)).toMatchObject({ is_repo: true, branch: null });
});

it("caps the file count", async () => {
  const path = await repo("many", { "1.txt": "1", "2.txt": "2", "3.txt": "3" });
  expect(await inspectRepo(path, { fileCap: 2 })).toMatchObject({ file_count: 2, file_count_capped: true });
  expect(await inspectRepo(path, { fileCap: 3 })).toMatchObject({ file_count: 3, file_count_capped: false });
});

it("treats a subfolder of a repository as not a repository, and names the repository it is in", async () => {
  const path = await repo("outer");
  const inner = join(path, "sub");
  await mkdir(inner);
  const result = await inspectRepo(inner);
  expect(result).toMatchObject({ exists: true, is_repo: false, branch: null, dirty: null, file_count: null });
  expect(result.root?.replace(/\\/g, "/").toLowerCase()).toBe(path.replace(/\\/g, "/").toLowerCase());
});

it("picks the test command's package manager from the lock file, and null without a test script", async () => {
  const scripts = JSON.stringify({ scripts: { test: "vitest run" } });
  expect((await inspectRepo(await folder("pnpm", { "package.json": scripts, "pnpm-lock.yaml": "" }))).test_command).toBe("pnpm test");
  expect((await inspectRepo(await folder("yarn", { "package.json": scripts, "yarn.lock": "" }))).test_command).toBe("yarn test");
  expect((await inspectRepo(await folder("npm", { "package.json": scripts }))).test_command).toBe("npm test");
  expect((await inspectRepo(await folder("none", { "package.json": JSON.stringify({ scripts: { build: "tsc" } }) }))).test_command).toBeNull();
  expect((await inspectRepo(await folder("broken", { "package.json": "{ not json" }))).test_command).toBeNull();
  expect((await inspectRepo(await folder("blank", { "package.json": JSON.stringify({ scripts: { test: "  " } }) }))).test_command).toBeNull();
});

it("never runs the project's own scripts or a configured fsmonitor hook", async () => {
  const marker = join(directory, "ran.txt");
  const path = await repo("hostile", { "package.json": JSON.stringify({ scripts: { test: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')"` } }) });
  const hook = join(directory, "hook.cjs");
  await writeFile(hook, `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");`);
  git(path, "config", "core.fsmonitor", `node ${hook.replace(/\\/g, "/")}`);
  expect((await inspectRepo(path)).is_repo).toBe(true);
  await expect(stat(marker)).rejects.toThrow();
});

it("is not an error for a folder that is not a repository, or a path that is not a folder", async () => {
  const plain = await folder("plain", { "package.json": JSON.stringify({ scripts: { test: "jest" } }) });
  const result = await inspectRepo(plain);
  expect(Object.keys(result).sort()).toEqual([...KEYS].sort());
  expect(result).toMatchObject({ exists: true, is_repo: false, root: null, branch: null, dirty: null, file_count: null, file_count_capped: false, test_command: "npm test" });

  const missing = await inspectRepo(join(directory, "missing"));
  expect(missing).toMatchObject({ exists: false, is_repo: false, root: null, branch: null, dirty: null, test_command: null, file_count: null });
  await writeFile(join(directory, "file.txt"), "x");
  expect((await inspectRepo(join(directory, "file.txt"))).exists).toBe(false);
});

it("rejects a path that is not absolute", async () => {
  await expect(inspectRepo("relative/folder")).rejects.toThrow(/absolute/i);
  await expect(inspectRepo("")).rejects.toThrow(/absolute/i);
  await expect(inspectRepo(`${directory}\0x`)).rejects.toThrow(/absolute/i);
});
