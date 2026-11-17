import type { Usage } from "@bulletin/core";
import { buildPrompt } from "./claude-code-runner";
import { attemptBranch, type AttemptHandle, type AttemptInput, type Runner, type RunnerEvent } from "./index";

/** The slice of the Managed Agents session stream this runner reads. Extra fields are ignored. */
export type ManagedSessionEvent =
  | { type: "agent.message"; content: { type: string; text?: string }[] }
  | { type: "agent.tool_use"; name: string; input?: Record<string, unknown> }
  | {
      type: "span.model_request_end";
      model_usage: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    }
  | { type: "session.status_idle"; stop_reason: { type: string } }
  | { type: "session.status_terminated" }
  | { type: "session.error"; error?: { message?: string } }
  | { type: string };

export interface ManagedSessionParams {
  prompt: string;
  model: string;
  /** Branch the agent must commit and push to. */
  branch: string;
  baseBranch: string;
  /** Hard cap for the session in cents; omitted when 0 or less. */
  budgetCents?: number;
}

/**
 * What the runner needs from the Anthropic SDK. A thin adapter over `client.beta.sessions`
 * implements this (kept out of the runner so tests need no network and no dependency).
 */
export interface ManagedClient {
  createSession(params: ManagedSessionParams): Promise<{ id: string }>;
  streamEvents(sessionId: string): AsyncIterable<ManagedSessionEvent>;
  interrupt(sessionId: string): Promise<void>;
}

/** Bring the agent's pushed branch into the local repository under the same name. */
export type FetchBranch = (branch: string) => Promise<void>;

export function mapManagedEvent(event: ManagedSessionEvent, model: string): RunnerEvent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = event as Record<string, any>;
  switch (event.type) {
    case "agent.message": {
      const text = (e.content ?? [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text ?? "")
        .join("");
      return text ? [{ type: "progress", text: text.slice(0, 300) }] : [];
    }
    case "agent.tool_use": {
      const input = e.input ?? {};
      return [
        {
          type: "tool_use",
          tool: String(e.name),
          summary: String(input.file_path ?? input.command ?? input.pattern ?? "").slice(0, 200),
        },
      ];
    }
    case "span.model_request_end": {
      const u = e.model_usage ?? {};
      const usage: Usage = {
        input_tokens: Number(u.input_tokens) || 0,
        output_tokens: Number(u.output_tokens) || 0,
        cache_read_tokens: Number(u.cache_read_input_tokens) || 0,
        cache_write_tokens: Number(u.cache_creation_input_tokens) || 0,
      };
      return [{ type: "usage", model, usage }];
    }
    default:
      return [];
  }
}

/** The prompt for a cloud station: the same unit text, plus where to put the work. */
export function buildManagedPrompt(input: AttemptInput, branch: string): string {
  return [
    buildPrompt(input).replace(
      "Commit nothing; the harness commits for you.",
      "Work inside the repository checkout.",
    ),
    `When the acceptance commands pass, commit your work and push it to the branch ${branch} (create it from ${input.baseBranch}). Pushing that branch is how you hand the work in.`,
  ].join("\n\n");
}

/**
 * Runs each attempt as a Claude Managed Agents session in Anthropic's cloud sandbox. The
 * session has a hard dollar budget; the finished work comes back as a pushed branch.
 */
export class ManagedAgentsRunner implements Runner {
  readonly kind = "managed-agents" as const;
  private readonly attempts = new Map<string, { input: AttemptInput; sessionId: string }>();

  constructor(
    private readonly client: ManagedClient,
    private readonly fetchBranch: FetchBranch,
  ) {}

  async startAttempt(input: AttemptInput): Promise<AttemptHandle> {
    const branch = attemptBranch(input.missionId, input.unit.id, input.attempt);
    const session = await this.client.createSession({
      prompt: buildManagedPrompt(input, branch),
      model: input.model,
      branch,
      baseBranch: input.baseBranch,
      budgetCents: input.allowanceCents > 0 ? input.allowanceCents : undefined,
    });
    const handle: AttemptHandle = { ref: `ma:${session.id}`, branch };
    this.attempts.set(handle.ref, { input, sessionId: session.id });
    return handle;
  }

  async *events(handle: AttemptHandle): AsyncIterable<RunnerEvent> {
    const entry = this.attempts.get(handle.ref);
    if (!entry) {
      yield { type: "done", ok: false, error: "unknown attempt" };
      return;
    }
    try {
      for await (const ev of this.client.streamEvents(entry.sessionId)) {
        yield* mapManagedEvent(ev, entry.input.model);
        if (ev.type === "session.error") {
          const message = (ev as { error?: { message?: string } }).error?.message ?? "unknown";
          yield { type: "done", ok: false, error: `session error: ${message}` };
          return;
        }
        if (ev.type === "session.status_idle") {
          const reason = (ev as { stop_reason: { type: string } }).stop_reason.type;
          if (reason === "requires_action") {
            yield { type: "done", ok: false, error: "session is waiting for an approval no one can give" };
            return;
          }
          if (reason !== "end_turn") {
            yield { type: "done", ok: false, error: `session stopped: ${reason}` };
            return;
          }
          try {
            await this.fetchBranch(handle.branch);
          } catch (e) {
            yield { type: "done", ok: false, error: `could not fetch ${handle.branch}: ${(e as Error).message}` };
            return;
          }
          yield { type: "done", ok: true };
          return;
        }
        if (ev.type === "session.status_terminated") {
          yield { type: "done", ok: false, error: "session terminated before finishing" };
          return;
        }
      }
      yield { type: "done", ok: false, error: "stream ended before the session finished" };
    } catch (e) {
      yield { type: "done", ok: false, error: `stream failed: ${(e as Error).message}` };
    }
  }

  async cancel(handle: AttemptHandle): Promise<void> {
    const entry = this.attempts.get(handle.ref);
    if (entry) await this.client.interrupt(entry.sessionId).catch(() => {});
    this.attempts.delete(handle.ref);
  }
}
