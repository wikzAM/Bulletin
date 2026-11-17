import { describe, expect, it } from "vitest";
import {
  ManagedAgentsRunner,
  mapManagedEvent,
  type ManagedClient,
  type ManagedSessionEvent,
} from "./managed-agents-runner";
import type { AttemptInput, RunnerEvent } from "./index";

const input: AttemptInput = {
  missionId: "m1",
  attempt: 1,
  baseBranch: "bulletin/m1/integration",
  briefingSlice: "",
  rules: "",
  model: "claude-sonnet-5-5",
  allowanceCents: 150,
  unit: { id: "u1", title: "t", task: "do it", files: ["src/**"], acceptance: ["pnpm test"] } as never,
};

function fakeClient(events: ManagedSessionEvent[], created: unknown[] = []): ManagedClient {
  return {
    async createSession(p) {
      created.push(p);
      return { id: "sess_1" };
    },
    async *streamEvents() {
      for (const e of events) yield e;
    },
    async interrupt() {},
  };
}

async function collect(it: AsyncIterable<RunnerEvent>): Promise<RunnerEvent[]> {
  const out: RunnerEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("mapManagedEvent", () => {
  it("maps messages, tool use and usage", () => {
    expect(mapManagedEvent({ type: "agent.message", content: [{ type: "text", text: "hi" }] }, "m")).toEqual([
      { type: "progress", text: "hi" },
    ]);
    expect(mapManagedEvent({ type: "agent.tool_use", name: "bash", input: { command: "ls" } }, "m")).toEqual([
      { type: "tool_use", tool: "bash", summary: "ls" },
    ]);
    const [u] = mapManagedEvent(
      {
        type: "span.model_request_end",
        model_usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 3 },
      },
      "m",
    );
    expect(u).toMatchObject({
      type: "usage",
      model: "m",
      usage: { input_tokens: 5, output_tokens: 2, cache_read_tokens: 1, cache_write_tokens: 3 },
    });
  });
});

describe("ManagedAgentsRunner", () => {
  it("creates a budgeted session, fetches the branch on end_turn and reports done", async () => {
    const created: unknown[] = [];
    const fetched: string[] = [];
    const runner = new ManagedAgentsRunner(
      fakeClient([{ type: "session.status_idle", stop_reason: { type: "end_turn" } }], created),
      async (branch) => void fetched.push(branch),
    );
    const handle = await runner.startAttempt(input);
    expect(handle.ref).toBe("ma:sess_1");
    expect(handle.branch).toBe("bulletin/m1/u1-a1");
    expect(created[0]).toMatchObject({
      budgetCents: 150,
      branch: "bulletin/m1/u1-a1",
      baseBranch: "bulletin/m1/integration",
    });
    const evs = await collect(runner.events(handle));
    expect(fetched).toEqual(["bulletin/m1/u1-a1"]);
    expect(evs.at(-1)).toEqual({ type: "done", ok: true });
  });
  it("runs the beforeStart hook before creating the session", async () => {
    const order: string[] = [];
    const client = fakeClient([]);
    const create = client.createSession.bind(client);
    client.createSession = async (p) => {
      order.push("create");
      return create(p);
    };
    const runner = new ManagedAgentsRunner(client, async () => {}, async () => void order.push("hook"));
    await runner.startAttempt(input);
    expect(order).toEqual(["hook", "create"]);
  });
  it("fails the attempt when the budget is reached, without fetching", async () => {
    const fetched: string[] = [];
    const runner = new ManagedAgentsRunner(
      fakeClient([{ type: "session.status_idle", stop_reason: { type: "budget_reached" } }]),
      async (b) => void fetched.push(b),
    );
    const evs = await collect(runner.events(await runner.startAttempt(input)));
    expect(evs.at(-1)).toMatchObject({ type: "done", ok: false });
    expect(fetched).toEqual([]);
  });
  it("fails when the session errors", async () => {
    const runner = new ManagedAgentsRunner(
      fakeClient([{ type: "session.error", error: { message: "boom" } }]),
      async () => {},
    );
    const evs = await collect(runner.events(await runner.startAttempt(input)));
    expect(evs.at(-1)).toMatchObject({ type: "done", ok: false, error: expect.stringContaining("boom") });
  });
  it("fails when the branch fetch fails", async () => {
    const runner = new ManagedAgentsRunner(
      fakeClient([{ type: "session.status_idle", stop_reason: { type: "end_turn" } }]),
      async () => {
        throw new Error("no such branch");
      },
    );
    const evs = await collect(runner.events(await runner.startAttempt(input)));
    expect(evs.at(-1)).toMatchObject({ type: "done", ok: false, error: expect.stringContaining("no such branch") });
  });
});
