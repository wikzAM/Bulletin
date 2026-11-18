import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Usage } from "@bulletin/core";
import { addWorktree, git } from "./git";
import { attemptBranch, type AttemptHandle, type AttemptInput, type Runner, type RunnerEvent } from "./index";

/** What a scripted station does on one attempt. */
export interface StubStep {
  /** Files to write, repo-relative path to contents. */
  files: Record<string, string>;
  /** How long the station "works", so tests can see attempts overlap. Default 0. */
  delayMs?: number;
  /** Usage to report. Default: 1000 input and 100 output tokens. */
  usage?: Partial<Usage>;
  /** Provider to report on the usage event. Default "stub". */
  provider?: string;
  /** Fail the attempt with this error instead of finishing. */
  error?: string;
}

/** Decides what a station does, from the attempt it was given. */
export type StubScript = (input: AttemptInput) => StubStep;

/**
 * A runner with no model behind it: each attempt writes the files its script says, in a real
 * worktree on a real attempt branch, and commits them. It exercises everything around a
 * station (branches, the pass, lanes, send-backs, the ledger) deterministically.
 */
export class StubRunner implements Runner {
  readonly kind = "stub" as const;
  private readonly steps = new Map<string, { step: StubStep; input: AttemptInput; handle: AttemptHandle }>();

  constructor(
    private readonly repo: string,
    private readonly scratchDir: string,
    private readonly script: StubScript,
  ) {}

  async startAttempt(input: AttemptInput): Promise<AttemptHandle> {
    const branch = attemptBranch(input.missionId, input.unit.id, input.attempt);
    const workdir = join(this.scratchDir, `${input.unit.id}-a${input.attempt}`);
    await addWorktree(this.repo, workdir, branch, input.baseBranch);
    const handle: AttemptHandle = { ref: `stub:${input.unit.id}:${input.attempt}`, branch, workdir };
    this.steps.set(handle.ref, { step: this.script(input), input, handle });
    return handle;
  }

  async *events(handle: AttemptHandle): AsyncIterable<RunnerEvent> {
    const entry = this.steps.get(handle.ref);
    if (!entry || !handle.workdir) {
      yield { type: "done", ok: false, error: "unknown attempt" };
      return;
    }
    const { step, input } = entry;
    yield { type: "progress", text: `stub station working on ${input.unit.id}` };
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));

    for (const [path, contents] of Object.entries(step.files)) {
      const full = join(handle.workdir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, contents, "utf8");
      yield { type: "tool_use", tool: "write", summary: path };
    }

    yield {
      type: "usage",
      model: input.model,
      provider: step.provider ?? "stub",
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, ...step.usage },
    };

    if (step.error) {
      yield { type: "done", ok: false, error: step.error };
      return;
    }
    await git(handle.workdir, "add", "-A");
    const dirty = await git(handle.workdir, "status", "--porcelain");
    if (dirty) await git(handle.workdir, "commit", "-q", "-m", `${input.unit.id} attempt ${input.attempt}`);
    yield { type: "done", ok: true };
  }

  async cancel(handle: AttemptHandle): Promise<void> {
    this.steps.delete(handle.ref);
  }
}
