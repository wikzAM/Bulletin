import type Anthropic from "@anthropic-ai/sdk";
import type { ManagedClient, ManagedSessionEvent, ManagedSessionParams } from "@bulletin/runners/managed-agents-runner";

export interface ManagedSetup {
  /** agent_... created once (see docs/MANAGED-AGENTS.md). */
  agentId: string;
  /** env_... created once. */
  environmentId: string;
  /** The scratch GitHub repository the sandbox clones and pushes to, e.g. https://github.com/owner/repo */
  repoUrl: string;
  /** A token with push rights to that repository only. Read from the environment, never written to disk. */
  githubToken: string;
}

/** The part of the SDK this adapter calls, so a test can pass a fake. */
export type SessionsApi = Pick<Anthropic["beta"]["sessions"], "create" | "events">;

/** Adapts the Anthropic SDK's Managed Agents sessions to the runner's small ManagedClient interface. */
export function sdkManagedClient(sessions: SessionsApi, setup: ManagedSetup): ManagedClient {
  return {
    async createSession(p: ManagedSessionParams) {
      const session = await sessions.create({
        agent: setup.agentId,
        environment_id: setup.environmentId,
        title: p.branch,
        ...(p.budgetCents
          ? { budget: { type: "limit", max_list_cost: { amount: String(p.budgetCents), currency: "USD" } } }
          : {}),
        resources: [
          {
            type: "github_repository",
            url: setup.repoUrl,
            mount_path: "/workspace/repo",
            authorization_token: setup.githubToken,
            checkout: { type: "branch", name: p.baseBranch },
          },
        ],
      } as never);
      // Stream-first: the first message goes out once the stream is open, in streamEvents below.
      pending.set(session.id, p.prompt);
      return { id: session.id };
    },
    async *streamEvents(sessionId: string) {
      const stream = await sessions.events.stream(sessionId);
      const prompt = pending.get(sessionId);
      pending.delete(sessionId);
      if (prompt) {
        await sessions.events.send(sessionId, {
          events: [{ type: "user.message", content: [{ type: "text", text: prompt }] }],
        } as never);
      }
      for await (const event of stream) yield event as unknown as ManagedSessionEvent;
    },
    async interrupt(sessionId: string) {
      await sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] } as never);
    },
  };
}

/** Prompts waiting for their stream to open, by session id. */
const pending = new Map<string, string>();
