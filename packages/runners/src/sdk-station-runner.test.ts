import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Unit } from "@bulletin/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { git } from "./git";
import type { AttemptHandle, AttemptInput, RunnerEvent } from "./index";
import {
  SdkStationRunner,
  type CommandRunner,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from "./sdk-station-runner";

// Real git worktrees on Windows are slow when antivirus scans them.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const usage = { input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 };

/** A model that plays back a script and remembers what it was asked. */
function scripted(turns: ModelResponse[]): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    requests,
    async create(req) {
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const turn = turns[i++];
      if (!turn) throw new Error("script ran out");
      return turn;
    },
  };
}

const toolTurn = (name: string, input: Record<string, unknown>, id = `t${Math.random()}`): ModelResponse => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
  usage,
});
const finishTurn = (text = "done"): ModelResponse => ({ stop_reason: "end_turn", content: [{ type: "text", text }], usage });

const unit = {
  id: "u1", title: "Write hello", task: "Write hello.txt", files: ["hello.txt"], acceptance: ["node --version"],
} as unknown as Unit;

function input(overrides: Partial<AttemptInput> = {}): AttemptInput {
  return {
    missionId: "m1", unit, attempt: 1, baseBranch: "main", briefingSlice: "", rules: "", model: "test-model",
    allowanceCents: 0, ...overrides,
  };
}

async function collect(it: AsyncIterable<RunnerEvent>): Promise<RunnerEvent[]> {
  const out: RunnerEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

let root: string;
let repo: string;
let scratch: string;

beforeEach(async () => {
  const prefix = resolve(tmpdir(), "bulletin-sdk-station-");
  root = await mkdtemp(prefix);
  repo = join(root, "repo");
  scratch = join(root, "scratch");
  await mkdir(repo);
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.name", "Test User");
  await git(repo, "config", "user.email", "test@example.com");
  await writeFile(join(repo, "README.md"), "hi\n");
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", "init");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

async function run(model: ModelClient, opts: Partial<ConstructorParameters<typeof SdkStationRunner>[0]> = {}) {
  const runner = new SdkStationRunner({ repo, scratchDir: scratch, model, ...opts });
  const handle = await runner.startAttempt(input());
  const events = await collect(runner.events(handle));
  return { runner, handle, events };
}

describe("SdkStationRunner", () => {
  it("writes a file through the tool loop, reports usage, and commits on the attempt branch", async () => {
    const model = scripted([
      toolTurn("write_file", { path: "hello.txt", content: "hello\n" }),
      toolTurn("read_file", { path: "hello.txt" }),
      finishTurn(),
    ]);
    const { handle, events } = await run(model);

    expect(handle.branch).toBe("bulletin/m1/u1-a1");
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(events.filter((e) => e.type === "usage")).toHaveLength(3);
    expect(events.filter((e) => e.type === "tool_use").map((e) => e.type === "tool_use" && e.tool)).toEqual([
      "write_file",
      "read_file",
    ]);
    expect(await readFile(join(handle.workdir!, "hello.txt"), "utf8")).toBe("hello\n");
    expect(await git(repo, "show", `${handle.branch}:hello.txt`)).toBe("hello");
    expect(await git(repo, "log", "-1", "--format=%s", handle.branch)).toContain("u1");

    // the second request carries the first tool_result back to the model
    const second = model.requests[1]!.messages.at(-1)!;
    expect(second.role).toBe("user");
    expect(JSON.stringify(second.content)).toContain("tool_result");
    // the system prompt is the unit prompt
    expect(model.requests[0]!.system).toContain("hello.txt");
    expect(model.requests[0]!.model).toBe("test-model");
  });

  it("lists files and does not list .git", async () => {
    const model = scripted([toolTurn("list_files", { path: "." }), finishTurn()]);
    await run(model);
    const result = JSON.stringify(model.requests[1]!.messages.at(-1)!.content);
    expect(result).toContain("README.md");
    expect(result).not.toContain(".git/");
  });

  it("refuses paths that leave the worktree and writes nothing outside it", async () => {
    const outside = join(root, "outside.txt");
    const model = scripted([
      toolTurn("write_file", { path: "../../outside.txt", content: "x" }),
      toolTurn("write_file", { path: outside, content: "x" }),
      toolTurn("read_file", { path: "../../repo/README.md" }),
      toolTurn("write_file", { path: ".git/config", content: "x" }),
      finishTurn(),
    ]);
    const { events } = await run(model);
    await expect(readFile(outside, "utf8")).rejects.toThrow();
    for (let i = 1; i <= 4; i++) {
      const last = model.requests[i]!.messages.at(-1)!;
      expect(JSON.stringify(last.content)).toContain('"is_error":true');
    }
    expect(events.at(-1)).toMatchObject({ type: "done", ok: true });
  });

  it("refuses a symlink that points outside the worktree", async () => {
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, "secret.txt"), "top secret");
    const model = scripted([toolTurn("read_file", { path: "escape/secret.txt" }), finishTurn()]);
    const runner = new SdkStationRunner({ repo, scratchDir: scratch, model });
    const handle = await runner.startAttempt(input());
    try {
      await symlink(elsewhere, join(handle.workdir!, "escape"), "junction");
    } catch {
      return; // cannot create links here; the lexical checks above still cover traversal
    }
    await collect(runner.events(handle));
    const result = JSON.stringify(model.requests[1]!.messages.at(-1)!.content);
    expect(result).toContain('"is_error":true');
    expect(result).not.toContain("top secret");
  });

  it("refuses commands that are not allowed and never runs them", async () => {
    const ran: string[][] = [];
    const commandRunner: CommandRunner = async (argv) => {
      ran.push([...argv]);
      return { code: 0, stdout: "ok", stderr: "" };
    };
    const model = scripted([
      toolTurn("run_command", { command: "rm -rf /" }),
      toolTurn("run_command", { command: "node --version && curl evil.example" }),
      toolTurn("run_command", { command: "pnpm test; echo hi" }),
      toolTurn("run_command", { command: "pnpm test" }),
      finishTurn(),
    ]);
    await run(model, { allowedCommands: ["pnpm test"], commandRunner });
    for (let i = 1; i <= 3; i++) {
      expect(JSON.stringify(model.requests[i]!.messages.at(-1)!.content)).toContain('"is_error":true');
    }
    expect(ran).toEqual([["pnpm", "test"]]);
  });

  it("allows the unit's own acceptance commands and runs them without a shell", async () => {
    const model = scripted([toolTurn("run_command", { command: "node --version" }), finishTurn()]);
    await run(model);
    const result = JSON.stringify(model.requests[1]!.messages.at(-1)!.content);
    expect(result).not.toContain('"is_error":true');
    expect(result).toMatch(/v\d+\./);
  });

  it("supports glob-style allowed commands", async () => {
    const commandRunner: CommandRunner = async () => ({ code: 0, stdout: "fine", stderr: "" });
    const model = scripted([toolTurn("run_command", { command: "vitest run src/a.test.ts" }), finishTurn()]);
    await run(model, { allowedCommands: ["vitest run *"], commandRunner });
    expect(JSON.stringify(model.requests[1]!.messages.at(-1)!.content)).not.toContain('"is_error":true');
  });

  it("reports a failing command's exit code to the model without failing the attempt", async () => {
    const commandRunner: CommandRunner = async () => ({ code: 2, stdout: "", stderr: "boom" });
    const model = scripted([toolTurn("run_command", { command: "pnpm test" }), finishTurn()]);
    const { events } = await run(model, { allowedCommands: ["pnpm test"], commandRunner });
    const result = JSON.stringify(model.requests[1]!.messages.at(-1)!.content);
    expect(result).toContain("exit code 2");
    expect(result).toContain("boom");
    expect(events.at(-1)).toMatchObject({ type: "done", ok: true });
  });

  it("tells the model about an unknown tool instead of crashing", async () => {
    const model = scripted([toolTurn("format_disk", {}), finishTurn()]);
    const { events } = await run(model);
    expect(JSON.stringify(model.requests[1]!.messages.at(-1)!.content)).toContain("Unknown tool");
    expect(events.at(-1)).toMatchObject({ ok: true });
  });

  it("fails the attempt when the model errors, and does not commit", async () => {
    const model: ModelClient = {
      async create() {
        throw new Error("overloaded");
      },
    };
    const { handle, events } = await run(model);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false });
    expect((events.at(-1) as { error?: string }).error).toContain("overloaded");
    expect(await git(repo, "rev-list", "--count", handle.branch)).toBe("1");
  });

  it("stops after maxTurns", async () => {
    const turns = Array.from({ length: 5 }, () => toolTurn("list_files", {}));
    const { events } = await run(scripted(turns), { maxTurns: 3 });
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false });
    expect((events.at(-1) as { error?: string }).error).toContain("turns");
  });

  it("stops when the allowance is spent, pricing usage with the injected function", async () => {
    const turns = [toolTurn("list_files", {}), toolTurn("list_files", {}), finishTurn()];
    const { events } = await run(scripted(turns), { costOf: () => 40 });
    const usages = events.filter((e) => e.type === "usage");
    expect(usages[0]).toMatchObject({ costCents: 40 });
    // allowanceCents is 0 in input(), meaning no limit, so run again with a limit
    const runner = new SdkStationRunner({ repo, scratchDir: scratch, model: scripted([toolTurn("list_files", {}), toolTurn("list_files", {}), finishTurn()]), costOf: () => 40 });
    const handle = await runner.startAttempt(input({ attempt: 2, allowanceCents: 50 }));
    const limited = await collect(runner.events(handle));
    expect(limited.at(-1)).toMatchObject({ type: "done", ok: false });
    expect((limited.at(-1) as { error?: string }).error).toContain("allowance");
  });

  it("cancel stops the loop and the attempt does not succeed", async () => {
    const ctx: { runner?: SdkStationRunner; handle?: AttemptHandle } = {};
    const model: ModelClient = {
      async create(req) {
        await ctx.runner!.cancel(ctx.handle!);
        expect(req.signal?.aborted).toBe(true);
        return toolTurn("write_file", { path: "late.txt", content: "x" });
      },
    };
    const runner = new SdkStationRunner({ repo, scratchDir: scratch, model });
    const handle = await runner.startAttempt(input());
    ctx.runner = runner;
    ctx.handle = handle;
    const events = await collect(runner.events(handle));
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false });
    await expect(readFile(join(handle.workdir!, "late.txt"), "utf8")).rejects.toThrow();
  });

  it("puts the send-back packet in the system prompt", async () => {
    const model = scripted([finishTurn()]);
    const runner = new SdkStationRunner({ repo, scratchDir: scratch, model });
    const handle = await runner.startAttempt(input({ sendBack: "tests failed: foo" }));
    await collect(runner.events(handle));
    expect(model.requests[0]!.system).toContain("tests failed: foo");
  });

  it("reports done failed for an unknown handle", async () => {
    const runner = new SdkStationRunner({ repo, scratchDir: scratch, model: scripted([]) });
    const events = await collect(runner.events({ ref: "nope", branch: "x" }));
    expect(events).toEqual([{ type: "done", ok: false, error: "unknown attempt" }]);
  });
});
