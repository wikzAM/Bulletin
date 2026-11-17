import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a program with an argument list and no shell. Never throws on a non-zero exit. */
export function exec(file: string, args: readonly string[], cwd: string, timeoutMs = 600_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) + (error && code === 1 && !stderr ? error.message : "") });
      },
    );
  });
}

/** Run git and return stdout. Throws with stderr when git fails. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await exec("git", args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Like git(), but returns the result instead of throwing. */
export function tryGit(cwd: string, ...args: string[]): Promise<ExecResult> {
  return exec("git", args, cwd);
}

/** Worktree changes lock the repository's shared metadata, so parallel stations take turns. */
let worktreeQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const next = worktreeQueue.then(task, task);
  worktreeQueue = next.catch(() => undefined);
  return next;
}

/** Add a worktree at `path` on a new branch cut from `base`. */
export function addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  return oneAtATime(async () => {
    await mkdir(dirname(path), { recursive: true });
    await git(repo, "worktree", "add", "-q", "-b", branch, path, base);
  });
}

/** Add a detached worktree at `path` checked out at `ref`: a clean checkout nothing else writes to. */
export function addDetachedWorktree(repo: string, path: string, ref: string): Promise<void> {
  return oneAtATime(async () => {
    await mkdir(dirname(path), { recursive: true });
    await git(repo, "worktree", "add", "-q", "--detach", path, ref);
  });
}

/** Remove a worktree; missing worktrees are ignored so cleanup can always run. */
export function removeWorktree(repo: string, path: string): Promise<void> {
  return oneAtATime(async () => {
    await tryGit(repo, "worktree", "remove", "--force", path);
    await tryGit(repo, "worktree", "prune");
  });
}
