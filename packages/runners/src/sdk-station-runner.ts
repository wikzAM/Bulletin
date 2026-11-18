import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Usage } from "@bulletin/core";
import type { ContentBlock, ModelClient, ModelMessage, ModelResponse, ToolDefinition } from "@bulletin/models";
import { buildPrompt } from "./claude-code-runner";
import { addWorktree, git, type ExecResult } from "./git";
import { attemptBranch, type AttemptHandle, type AttemptInput, type Runner, type RunnerEvent } from "./index";

/* ---- The model seam lives in @bulletin/models; re-exported so existing imports keep working. ---- */

export type { ContentBlock, ModelClient, ModelMessage, ModelRequest, ModelResponse, ToolDefinition } from "@bulletin/models";

/** Runs a program with an argument list, no shell chaining. Injected for tests. */
export type CommandRunner = (argv: readonly string[], cwd: string, timeoutMs: number) => Promise<ExecResult>;

export interface SdkStationRunnerOptions {
  repo: string;
  scratchDir: string;
  model: ModelClient;
  /**
   * Glob-style patterns ("pnpm test", "vitest run *") a station may run, in addition to the
   * unit's own acceptance commands.
   */
  allowedCommands?: readonly string[];
  commandRunner?: CommandRunner;
  /** Prices one call from the config/ price table. Without it, usage events carry no cost and the allowance is not enforced. */
  costOf?: (model: string, usage: Usage) => number;
  /** Most model calls per attempt. Default 40. */
  maxTurns?: number;
  maxTokens?: number;
  commandTimeoutMs?: number;
}

const DEFAULT_MAX_TURNS = 40;
const MAX_READ_BYTES = 200_000;
const MAX_OUTPUT_CHARS = 20_000;

const TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file in the worktree. Path is relative to the worktree root.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the worktree. Parent folders are created.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List a folder in the worktree (default the root). Folders end with a slash.",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "run_command",
    description:
      "Run one allowed command in the worktree, for example the unit's acceptance commands. No pipes, chaining or redirection.",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
];

/** Same characters the plan validator rejects: anything that lets one command start another. */
const SHELL_METACHARACTERS = /[;&|`<>\r\n]|\$\(|\$\{/;

export function commandMatches(command: string, patterns: readonly string[]): boolean {
  if (SHELL_METACHARACTERS.test(command)) return false;
  return patterns.some((pattern) => {
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`, "s").test(command);
  });
}

/** Split a command line into arguments, honouring simple single and double quotes. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/**
 * Default: start the program directly (metacharacters are already refused, so no shell is needed).
 * On Windows, .cmd shims (pnpm, tsc, vitest...) can only start through cmd.exe, so a direct start
 * that cannot find the program is retried there.
 */
const defaultCommandRunner: CommandRunner = (argv, cwd, timeoutMs) =>
  new Promise((resolvePromise) => {
    const [file, ...args] = argv;
    if (!file) return resolvePromise({ code: 1, stdout: "", stderr: "empty command" });
    let stdout = "";
    let stderr = "";
    const launch = (shell: boolean) => {
      const child = spawn(file, args, { cwd, windowsHide: true, shell });
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on("data", (d) => (stdout += String(d)));
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (!shell && process.platform === "win32" && e.code === "ENOENT") launch(true);
        else resolvePromise({ code: 127, stdout, stderr: stderr + e.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (child.pid === undefined || (code !== null && code < 0)) return; // the start failed; "error" decides what happens
        resolvePromise({ code: code ?? 1, stdout, stderr });
      });
    };
    launch(false);
  });

class ToolError extends Error {}

/** Resolve a tool path inside the worktree or throw. Refuses absolute paths, "..", .git and links that leave it. */
async function confine(workdir: string, path: unknown): Promise<string> {
  if (typeof path !== "string" || path === "") throw new ToolError("path must be a non-empty string");
  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) throw new ToolError(`path must be relative to the worktree: ${path}`);
  const root = resolve(workdir);
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ToolError(`path is outside the worktree: ${path}`);
  }
  if (rel.split(sep)[0] === ".git") throw new ToolError("the .git folder is off limits");

  // A link inside the worktree could still point out of it: check the nearest existing ancestor.
  const realRoot = await realpath(root);
  let probe = full;
  for (;;) {
    try {
      const real = await realpath(probe);
      const realRel = relative(realRoot, real);
      if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
        throw new ToolError(`path is outside the worktree: ${path}`);
      }
      break;
    } catch (e) {
      if (e instanceof ToolError) throw e;
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return full;
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `...(truncated)\n${text.slice(-MAX_OUTPUT_CHARS)}` : text;
}

interface Attempt {
  input: AttemptInput;
  abort: AbortController;
}

/**
 * The default station: an agent loop over the Messages API, run inside the bundled sidecar with
 * no separate install. Four tools, all confined to the attempt's worktree; commands run only if
 * they match the allowed patterns (the unit's own acceptance commands count as allowed). The
 * harness commits on success, as with every other runner.
 *
 * This is a policy gate, not an OS sandbox: an allowed command (say `node script.js`) still runs
 * with the user's rights. The pass is what decides whether the work is accepted.
 */
export class SdkStationRunner implements Runner {
  readonly kind = "sdk-station" as const;
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly options: SdkStationRunnerOptions) {}

  async startAttempt(input: AttemptInput): Promise<AttemptHandle> {
    const branch = attemptBranch(input.missionId, input.unit.id, input.attempt);
    const workdir = join(this.options.scratchDir, `${input.unit.id}-a${input.attempt}`);
    await addWorktree(this.options.repo, workdir, branch, input.baseBranch);
    const handle: AttemptHandle = { ref: `sdk:${input.unit.id}:${input.attempt}`, branch, workdir };
    this.attempts.set(handle.ref, { input, abort: new AbortController() });
    return handle;
  }

  async *events(handle: AttemptHandle): AsyncIterable<RunnerEvent> {
    const attempt = this.attempts.get(handle.ref);
    if (!attempt || !handle.workdir) {
      yield { type: "done", ok: false, error: "unknown attempt" };
      return;
    }
    const { input, abort } = attempt;
    const workdir = handle.workdir;
    const { model, costOf } = this.options;
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS;
    const allowed = [...(this.options.allowedCommands ?? []), ...input.unit.acceptance];
    const system = buildPrompt(input);
    const messages: ModelMessage[] = [
      { role: "user", content: "Begin. Use the tools to do the unit's work, run its acceptance commands, then reply with a short summary." },
    ];
    let spentCents = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (abort.signal.aborted) {
        yield { type: "done", ok: false, error: "cancelled" };
        return;
      }
      let response: ModelResponse;
      try {
        response = await model.complete({
          model: input.model,
          system,
          messages,
          tools: TOOLS,
          max_tokens: this.options.maxTokens ?? 16_000,
          signal: abort.signal,
        });
      } catch (e) {
        yield { type: "done", ok: false, error: abort.signal.aborted ? "cancelled" : `model call failed: ${(e as Error).message}` };
        return;
      }
      if (abort.signal.aborted) {
        yield { type: "done", ok: false, error: "cancelled" };
        return;
      }

      const cost = costOf?.(input.model, response.usage);
      yield { type: "usage", model: input.model, provider: model.provider, usage: response.usage, ...(cost === undefined ? {} : { costCents: cost }) };
      if (cost !== undefined) spentCents += cost;

      messages.push({ role: "assistant", content: response.content });
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) yield { type: "progress", text: block.text.slice(0, 300) };
      }

      const toolUses = response.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
          yield* this.finish(workdir, input);
        } else {
          yield { type: "done", ok: false, error: `model stopped: ${response.stop_reason}` };
        }
        return;
      }

      if (input.allowanceCents > 0 && spentCents >= input.allowanceCents) {
        yield { type: "done", ok: false, error: `allowance spent (${spentCents} of ${input.allowanceCents} cents)` };
        return;
      }

      const results: ContentBlock[] = [];
      for (const use of toolUses) {
        yield { type: "tool_use", tool: use.name, summary: summarise(use.input) };
        if (abort.signal.aborted) {
          yield { type: "done", ok: false, error: "cancelled" };
          return;
        }
        try {
          const content = await this.runTool(use.name, use.input, workdir, allowed);
          results.push({ type: "tool_result", tool_use_id: use.id, content });
        } catch (e) {
          const message = e instanceof ToolError ? e.message : `tool failed: ${(e as Error).message}`;
          results.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    yield { type: "done", ok: false, error: `stopped after ${maxTurns} turns without finishing` };
  }

  private async *finish(workdir: string, input: AttemptInput): AsyncGenerator<RunnerEvent> {
    try {
      await git(workdir, "add", "-A");
      if (await git(workdir, "status", "--porcelain")) {
        await git(workdir, "commit", "-q", "-m", `${input.unit.id} attempt ${input.attempt}`);
      }
    } catch (e) {
      yield { type: "done", ok: false, error: `commit failed: ${(e as Error).message}` };
      return;
    }
    yield { type: "done", ok: true };
  }

  private async runTool(name: string, args: Record<string, unknown>, workdir: string, allowed: readonly string[]): Promise<string> {
    switch (name) {
      case "read_file": {
        const full = await confine(workdir, args.path);
        const info = await stat(full).catch(() => null);
        if (!info?.isFile()) throw new ToolError(`not a file: ${String(args.path)}`);
        if (info.size > MAX_READ_BYTES) throw new ToolError(`file too large (${info.size} bytes, limit ${MAX_READ_BYTES})`);
        return await readFile(full, "utf8");
      }
      case "write_file": {
        const full = await confine(workdir, args.path);
        if (typeof args.content !== "string") throw new ToolError("content must be a string");
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, args.content, "utf8");
        return `wrote ${args.content.length} characters to ${String(args.path)}`;
      }
      case "list_files": {
        const full = await confine(workdir, args.path === undefined ? "." : args.path);
        const entries = await readdir(full, { withFileTypes: true }).catch(() => {
          throw new ToolError(`not a folder: ${String(args.path ?? ".")}`);
        });
        return entries
          .filter((e) => e.name !== ".git")
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join("\n");
      }
      case "run_command": {
        const command = typeof args.command === "string" ? args.command.trim() : "";
        if (!command || !commandMatches(command, allowed)) {
          throw new ToolError(`command not allowed: ${command || "(empty)"}. Allowed: ${allowed.join(" ; ") || "(none)"}`);
        }
        const argv = splitCommand(command);
        // Arguments that name paths must stay inside the worktree too.
        for (const arg of argv.slice(1)) {
          if (!arg.startsWith("-") && (isAbsolute(arg) || /^[a-zA-Z]:/.test(arg) || arg.split(/[\\/]/).includes(".."))) {
            throw new ToolError(`command argument leaves the worktree: ${arg}`);
          }
        }
        const run = this.options.commandRunner ?? defaultCommandRunner;
        const r = await run(argv, workdir, this.options.commandTimeoutMs ?? 300_000);
        const body = clip([r.stdout, r.stderr].filter(Boolean).join("\n").trim());
        return r.code === 0 ? body || "(no output)" : `exit code ${r.code}\n${body}`;
      }
      default:
        throw new ToolError(`Unknown tool: ${name}`);
    }
  }

  async cancel(handle: AttemptHandle): Promise<void> {
    this.attempts.get(handle.ref)?.abort.abort();
  }
}

function summarise(input: Record<string, unknown>): string {
  return String(input.path ?? input.command ?? "").slice(0, 200);
}
