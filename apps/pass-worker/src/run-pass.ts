import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { LOCKED_PATHS, type PassVerdict, type Unit } from "@bulletin/core";
import { addDetachedWorktree, git, removeWorktree } from "@bulletin/runners/git";
import { judge, type CommandKind, type CommandResult, type JudgeInput } from "./judge";

/** Windows ships these as .cmd shims, which Node can only start through cmd.exe. Everything else starts directly. */
const CMD_SHIMS = /^(pnpm|npm|npx|yarn)(\.cmd)?$/i;

/** Every argument of a check command must look like this. Anything else is refused, not quoted. */
const SAFE_ARGUMENT = /^[\w@./:=,+-]+$/;

/** One taskkill attempt. Resolves true when the tree is gone (or was already gone). */
function taskkillOnce(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    killer.stdout.on("data", (d) => (text += String(d)));
    killer.stderr.on("data", (d) => (text += String(d)));
    const giveUp = setTimeout(() => resolve(false), 10_000);
    const done = (ok: boolean) => {
      clearTimeout(giveUp);
      resolve(ok);
    };
    killer.on("error", () => done(false));
    // Exit 128 / "not found" means the process is already gone, which is what we want.
    killer.on("close", (code) => done(code === 0 || /not found/i.test(text)));
  });
}

/**
 * Kill a process and everything it started. A plain child.kill() leaves grandchildren running (and
 * holding the pipes). taskkill goes through WMI, which can fail under load ("Quota violation",
 * "Call cancelled"), so a failed attempt is retried.
 */
async function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await taskkillOnce(pid)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    child.kill();
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // the whole process group: the child was started detached
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Run one check command as a supervised subprocess, as an argument list. The command is split on
 * whitespace and each argument must be plain (letters, digits, and @ . / : = , + - _), so nothing
 * in it can chain, pipe, substitute or redirect. On Windows the program may be a .cmd shim (pnpm,
 * npm), which Node can only start through cmd.exe; the argument rule above is what makes that safe.
 *
 * If the command is still running after `timeoutMs`, it and everything it started are killed
 * (taskkill /T on Windows, the process group elsewhere) and the result is exit code 124 with
 * "timed out" in the output. This is what makes the pass safe to run without a container.
 */
export function runCommand(kind: CommandKind, command: string, cwd: string, timeoutMs = 600_000): Promise<CommandResult> {
  const argv = command.trim().split(/\s+/).filter(Boolean);
  const bad = argv.find((a) => !SAFE_ARGUMENT.test(a));
  if (argv.length === 0 || bad !== undefined) {
    return Promise.resolve({ kind, command, exitCode: 126, output: `command not allowed: ${bad ?? "(empty)"}` });
  }
  return new Promise((resolve) => {
    const [program, ...args] = argv as [string, ...string[]];
    const child = spawn(program, args, {
      cwd,
      shell: process.platform === "win32" && CMD_SHIMS.test(program),
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    let killed: Promise<void> | undefined;
    let closed = false;
    const settle = (exitCode: number, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const note = timedOut ? `\ntimed out after ${Math.round(timeoutMs / 1000)}s and was killed` : "";
      resolve({ kind, command, exitCode: timedOut ? 124 : exitCode, output: output + extra + note });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      // The child may report "close" before taskkill returns; close waits for `killed` so nothing is left running.
      killed = killTree(child).then(async () => {
        // taskkill can lose a race with a process that is still starting; try once more if the child is still there.
        if (closed) return;
        await new Promise((r) => setTimeout(r, 2000));
        if (!closed) await killTree(child);
      });
      void killed.then(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle(124);
      });
    }, timeoutMs);
    child.stdout.on("data", (d) => (output += String(d)));
    child.stderr.on("data", (d) => (output += String(d)));
    child.on("error", (e) => settle(127, e.message));
    child.on("close", (code) => {
      closed = true;
      void (killed ?? Promise.resolve()).then(() => settle(code ?? 124));
    });
  });
}

export interface PassInput {
  /** The repository the branches live in. */
  repo: string;
  /** Where the clean checkout is created, and removed afterwards. */
  scratchDir: string;
  unit: Unit;
  /** The branch the station committed to. */
  unitBranch: string;
  /** The branch the unit was cut from. Check configuration is read from here, never from the unit branch. */
  integrationBranch: string;
  /** The repository's test command, if it has one. */
  testCommand?: string;
  typecheckCommand?: string;
  lintCommand?: string;
  maxDiffLines?: number;
  lockedPaths?: readonly string[];
  /** Longest any one check command may run before it is killed. Default 10 minutes. */
  commandTimeoutMs?: number;
}

/**
 * The deterministic pass on one attempt (spec section 11): what changed against the
 * integration branch, then the test and acceptance commands on a clean checkout of the unit
 * branch. The station has no say in any of it.
 */
export async function runPass(input: PassInput): Promise<PassVerdict> {
  const range = `${input.integrationBranch}...${input.unitBranch}`;
  const changedFiles = (await git(input.repo, "diff", "--name-only", range)).split("\n").filter(Boolean);
  const numstat = await git(input.repo, "diff", "--numstat", range);
  const diffLines = numstat
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => {
      const [added, removed] = line.split("\t");
      return sum + (Number(added) || 0) + (Number(removed) || 0);
    }, 0);

  const base: JudgeInput = {
    unitFiles: input.unit.files,
    changedFiles,
    lockedPaths: input.lockedPaths ?? LOCKED_PATHS,
    diffLines,
    maxDiffLines: input.maxDiffLines,
    commands: [],
  };
  const early = judge(base);
  if (early.verdict === "red") return early;

  const planned: Array<[CommandKind, string]> = [];
  if (input.testCommand) planned.push(["test", input.testCommand]);
  for (const command of input.unit.acceptance) planned.push(["acceptance", command]);
  if (input.typecheckCommand) planned.push(["typecheck", input.typecheckCommand]);
  if (input.lintCommand) planned.push(["lint", input.lintCommand]);

  const checkout = join(input.scratchDir, `pass-${input.unitBranch.replace(/[^\w.-]+/g, "_")}`);
  await addDetachedWorktree(input.repo, checkout, input.unitBranch);
  const commands: CommandResult[] = [];
  try {
    for (const [kind, command] of planned) {
      const result = await runCommand(kind, command, checkout, input.commandTimeoutMs);
      commands.push(result);
      if (result.exitCode !== 0) break;
    }
  } finally {
    await removeWorktree(input.repo, checkout);
  }
  return judge({ ...base, commands });
}
