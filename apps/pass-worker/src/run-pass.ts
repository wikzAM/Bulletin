import { spawn } from "node:child_process";
import { join } from "node:path";
import { LOCKED_PATHS, type PassVerdict, type Unit } from "@bulletin/core";
import { addDetachedWorktree, git, removeWorktree } from "@bulletin/runners/git";
import { judge, type CommandKind, type CommandResult, type JudgeInput } from "./judge";

/** Every argument of a check command must look like this. Anything else is refused, not quoted. */
const SAFE_ARGUMENT = /^[\w@./:=,+-]+$/;

/**
 * Run one check command as an argument list. The command is split on whitespace and each
 * argument must be plain (letters, digits, and @ . / : = , + - _), so nothing in it can chain,
 * pipe, substitute or redirect. On Windows the program may be a .cmd shim (pnpm, npm), which
 * Node can only start through cmd.exe; the argument rule above is what makes that safe.
 */
export function runCommand(kind: CommandKind, command: string, cwd: string, timeoutMs = 600_000): Promise<CommandResult> {
  const argv = command.trim().split(/\s+/).filter(Boolean);
  const bad = argv.find((a) => !SAFE_ARGUMENT.test(a));
  if (argv.length === 0 || bad !== undefined) {
    return Promise.resolve({ kind, command, exitCode: 126, output: `command not allowed: ${bad ?? "(empty)"}` });
  }
  return new Promise((resolve) => {
    const [program, ...args] = argv as [string, ...string[]];
    const child = spawn(program, args, { cwd, shell: process.platform === "win32", windowsHide: true });
    let output = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (output += String(d)));
    child.stderr.on("data", (d) => (output += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ kind, command, exitCode: 127, output: output + e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ kind, command, exitCode: code ?? 124, output });
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
      const result = await runCommand(kind, command, checkout);
      commands.push(result);
      if (result.exitCode !== 0) break;
    }
  } finally {
    await removeWorktree(input.repo, checkout);
  }
  return judge({ ...base, commands });
}
