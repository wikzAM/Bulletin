import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { Usage } from "@bulletin/core";
import { addWorktree, git } from "./git";
import { attemptBranch, type AttemptHandle, type AttemptInput, type Runner, type RunnerEvent } from "./index";

/** Turn one line of `claude -p --output-format stream-json` into runner events. Unknown lines yield nothing. */
export function parseStreamLine(line: string, model: string): RunnerEvent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let msg: Record<string, any> | null;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  const out: RunnerEvent[] = [];
  if (msg?.type === "assistant" && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) out.push({ type: "progress", text: String(block.text).slice(0, 300) });
      if (block.type === "tool_use") {
        const input = block.input ?? {};
        out.push({ type: "tool_use", tool: String(block.name), summary: String(input.file_path ?? input.command ?? input.pattern ?? "").slice(0, 200) });
      }
    }
  }
  if (msg?.type === "result") {
    const u = msg.usage ?? {};
    const usage: Usage = {
      input_tokens: Number(u.input_tokens) || 0,
      output_tokens: Number(u.output_tokens) || 0,
      cache_read_tokens: Number(u.cache_read_input_tokens) || 0,
      cache_write_tokens: Number(u.cache_creation_input_tokens) || 0,
    };
    out.push({ type: "usage", model, usage });
    const ok = msg.is_error !== true && msg.subtype === "success";
    out.push({ type: "done", ok, error: ok ? undefined : String(msg.result ?? msg.subtype ?? "claude failed") });
  }
  return out;
}

/** The prompt a station gets. Only its unit, its files, its tests and the rules. */
export function buildPrompt(input: AttemptInput): string {
  const u = input.unit;
  return [
    `You are a station on a Bulletin mission. Do exactly one unit of work: ${u.id}.`,
    `Task: ${u.title}. ${u.task}`,
    `You may only change files matching: ${u.files.join(", ")}.`,
    `When done, these commands must pass: ${u.acceptance.join(" ; ") || "(none)"}.`,
    "Do not touch anything outside your files. Commit nothing; the harness commits for you.",
    input.briefingSlice && `Briefing:\n${input.briefingSlice}`,
    input.rules && `Rules:\n${input.rules}`,
    input.sendBack && `Your previous attempt was sent back:\n${input.sendBack}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Runs each attempt as a headless Claude Code process in its own worktree. Credentials come
 * from the environment Claude Code already uses (a login, ANTHROPIC_API_KEY, or Bedrock vars).
 */
export class ClaudeCodeRunner implements Runner {
  readonly kind = "local-claude-code" as const;
  private readonly attempts = new Map<string, { input: AttemptInput; child?: ChildProcess }>();

  constructor(
    private readonly repo: string,
    private readonly scratchDir: string,
    private readonly claudeBin = "claude",
  ) {}

  async startAttempt(input: AttemptInput): Promise<AttemptHandle> {
    const branch = attemptBranch(input.missionId, input.unit.id, input.attempt);
    const workdir = join(this.scratchDir, `${input.unit.id}-a${input.attempt}`);
    await addWorktree(this.repo, workdir, branch, input.baseBranch);
    const handle: AttemptHandle = { ref: `cc:${input.unit.id}:${input.attempt}`, branch, workdir };
    this.attempts.set(handle.ref, { input });
    return handle;
  }

  async *events(handle: AttemptHandle): AsyncIterable<RunnerEvent> {
    const entry = this.attempts.get(handle.ref);
    if (!entry || !handle.workdir) {
      yield { type: "done", ok: false, error: "unknown attempt" };
      return;
    }
    const { input } = entry;
    const args = [
      "-p",
      buildPrompt(input),
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      input.model,
      "--permission-mode",
      "acceptEdits",
      "--max-budget-usd",
      (input.allowanceCents / 100).toFixed(2),
    ];
    const child = spawn(this.claudeBin, args, { cwd: handle.workdir, windowsHide: true, shell: false });
    entry.child = child;
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    const exit = new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)));
    child.on("error", (e) => (stderr += e.message));

    let buffer = "";
    let finished = false;
    for await (const chunk of child.stdout) {
      buffer += String(chunk);
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        for (const ev of line ? parseStreamLine(line, input.model) : []) {
          if (ev.type === "done") {
            finished = true;
            if (ev.ok) await this.commit(handle.workdir, input);
          }
          yield ev;
        }
      }
    }
    const code = await exit;
    if (!finished) yield { type: "done", ok: false, error: `claude exited ${code}: ${stderr.trim().slice(0, 300)}` };
  }

  private async commit(workdir: string, input: AttemptInput): Promise<void> {
    await git(workdir, "add", "-A");
    if (await git(workdir, "status", "--porcelain")) {
      await git(workdir, "commit", "-q", "-m", `${input.unit.id} attempt ${input.attempt}`);
    }
  }

  async cancel(handle: AttemptHandle): Promise<void> {
    this.attempts.get(handle.ref)?.child?.kill();
    this.attempts.delete(handle.ref);
  }
}
