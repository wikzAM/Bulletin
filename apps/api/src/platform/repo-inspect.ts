import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { resolveExecutable, runTool } from "./executables";
import { SECRET_NAMES } from "./keychain";

export interface RepoInfo {
  path: string;
  exists: boolean;
  /** True when `path` itself is the top folder of a git work tree. */
  is_repo: boolean;
  /** The top folder of the work tree that contains `path` (a parent folder when `path` is a subfolder), else null. */
  root: string | null;
  branch: string | null;
  dirty: boolean | null;
  test_command: string | null;
  file_count: number | null;
  file_count_capped: boolean;
}

export interface InspectOptions {
  fileCap?: number;
  env?: NodeJS.Dict<string>;
}

export const FILE_COUNT_CAP = 100_000;
const GIT_TIMEOUT_MS = 20_000;
const LISTING_BYTES = 16 * 1024 * 1024;
const NUL = "\0";

/**
 * The environment git gets in an untrusted folder: no stored secret and nothing that looks like a credential. A
 * repository can configure programs (filters, hooks of other commands) that git may start, and they inherit this.
 */
export function scrubSecrets(env: NodeJS.Dict<string>): NodeJS.Dict<string> {
  const clean: NodeJS.Dict<string> = {};
  for (const [name, value] of Object.entries(env)) {
    if ((SECRET_NAMES as readonly string[]).includes(name) || /(TOKEN|SECRET|PASSWORD|KEY|CREDENTIALS?)$/i.test(name)) continue;
    clean[name] = value;
  }
  return clean;
}

async function sameFolder(a: string, b: string): Promise<boolean> {
  const canonical = async (path: string) => {
    const real = await realpath(path).catch(() => path);
    const normal = resolve(real).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? normal.toLowerCase() : normal;
  };
  return (await canonical(a)) === (await canonical(b));
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** `scripts.test` from package.json, named for the package manager the lock file implies. The script is never run. */
async function detectTestCommand(path: string): Promise<string | null> {
  let scripts: unknown;
  try {
    scripts = (JSON.parse(await readFile(join(path, "package.json"), "utf8")) as { scripts?: unknown }).scripts;
  } catch {
    return null;
  }
  const test = typeof scripts === "object" && scripts !== null ? (scripts as { test?: unknown }).test : undefined;
  if (typeof test !== "string" || test.trim() === "") return null;
  const has = async (file: string) => stat(join(path, file)).then((s) => s.isFile(), () => false);
  if (await has("pnpm-lock.yaml")) return "pnpm test";
  if (await has("yarn.lock")) return "yarn test";
  return "npm test";
}

/**
 * Looks at a folder the person picked. The folder is untrusted: git runs with literal arguments and the repository's
 * fsmonitor hook switched off, no lock is taken, and package.json is only read.
 */
export async function inspectRepo(path: string, options: InspectOptions = {}): Promise<RepoInfo> {
  if (typeof path !== "string" || path === "" || path.includes(NUL) || !isAbsolute(path)) {
    throw new Error("Expected an absolute folder path");
  }
  const result: RepoInfo = { path, exists: false, is_repo: false, root: null, branch: null, dirty: null, test_command: null, file_count: null, file_count_capped: false };
  if (!(await isDirectory(path))) return result;
  result.exists = true;
  result.test_command = await detectTestCommand(path);

  const env = { ...scrubSecrets(options.env ?? process.env), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  const gitPath = resolveExecutable("git", env);
  if (!gitPath) return result;
  const git = (args: string[], maxBytes?: number) =>
    runTool(gitPath, ["-c", "core.fsmonitor=false", "--no-optional-locks", ...args], { cwd: path, env, timeoutMs: GIT_TIMEOUT_MS, maxBytes });

  const top = await git(["rev-parse", "--show-toplevel"]);
  const root = top.code === 0 ? top.stdout.trim() : "";
  if (root === "") return result;
  result.root = root;
  if (!(await sameFolder(root, path))) return result;
  result.is_repo = true;

  // One call gives the branch and, by listing any entry at all, whether anything has changed.
  const status = await git(["status", "--porcelain=v2", "--branch", "-z"]);
  if (status.code === 0) {
    const lines = status.stdout.split(NUL).filter(Boolean);
    const head = lines.find((line) => line.startsWith("# branch.head "))?.slice("# branch.head ".length);
    result.branch = head === undefined || head === "(detached)" ? null : head;
    result.dirty = lines.some((line) => !line.startsWith("# "));
  }

  const cap = options.fileCap ?? FILE_COUNT_CAP;
  const listing = await git(["ls-files", "-z"], LISTING_BYTES);
  if (listing.code === 0 || listing.truncated) {
    const count = listing.stdout.split(NUL).filter(Boolean).length;
    result.file_count_capped = listing.truncated || count > cap;
    result.file_count = result.file_count_capped ? cap : count;
  }
  return result;
}
