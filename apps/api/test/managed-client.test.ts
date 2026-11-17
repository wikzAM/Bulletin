import { describe, expect, it } from "vitest";
import { sdkManagedClient, type SessionsApi } from "../src/managed-client";

function fakeSessions(calls: { create: unknown[]; send: unknown[] }): SessionsApi {
  return {
    create: async (body: unknown) => {
      calls.create.push(body);
      return { id: "sess_9" };
    },
    events: {
      stream: async () =>
        (async function* () {
          yield { type: "session.status_idle", stop_reason: { type: "end_turn" } };
        })(),
      send: async (_id: string, body: unknown) => {
        calls.send.push(body);
      },
    },
  } as unknown as SessionsApi;
}

const setup = { agentId: "agent_1", environmentId: "env_1", repoUrl: "https://github.com/o/r", githubToken: "tok" };

describe("sdkManagedClient", () => {
  it("creates a budgeted session on the base branch and sends the prompt after the stream opens", async () => {
    const calls = { create: [] as unknown[], send: [] as unknown[] };
    const client = sdkManagedClient(fakeSessions(calls), setup);
    const { id } = await client.createSession({ prompt: "go", model: "m", branch: "b-a1", baseBranch: "base", budgetCents: 75 });
    expect(calls.create[0]).toMatchObject({
      agent: "agent_1",
      environment_id: "env_1",
      budget: { type: "limit", max_list_cost: { amount: "75", currency: "USD" } },
      resources: [{ type: "github_repository", checkout: { type: "branch", name: "base" } }],
    });
    expect(calls.send).toHaveLength(0);
    const seen: string[] = [];
    for await (const e of client.streamEvents(id)) seen.push(e.type);
    expect(seen).toEqual(["session.status_idle"]);
    expect(calls.send[0]).toMatchObject({ events: [{ type: "user.message" }] });
  });
  it("omits the budget when none is given", async () => {
    const calls = { create: [] as unknown[], send: [] as unknown[] };
    await sdkManagedClient(fakeSessions(calls), setup).createSession({ prompt: "x", model: "m", branch: "b", baseBranch: "base" });
    expect(calls.create[0]).not.toHaveProperty("budget");
  });
});
