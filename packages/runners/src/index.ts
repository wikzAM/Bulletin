import type { Unit, Usage } from "@bulletin/core";

/** All stations run through this one interface (spec section 14). */
export interface Runner {
  kind: "local-claude-code" | "managed-agents" | "byo" | "stub";
  startAttempt(input: AttemptInput): Promise<AttemptHandle>;
  /** Progress, tool use, usage, done. */
  events(handle: AttemptHandle): AsyncIterable<RunnerEvent>;
  cancel(handle: AttemptHandle): Promise<void>;
}

export interface AttemptInput {
  missionId: string;
  /** From plan.json. */
  unit: Unit;
  /** 1..3 */
  attempt: number;
  /** bulletin/<mission>/integration */
  baseBranch: string;
  /** Only the Briefing sections this unit needs. */
  briefingSlice: string;
  /** Contents of .bulletin/rules.md. */
  rules: string;
  /** Packet from the previous RED attempt. */
  sendBack?: string;
  /** Resolved from the unit's tier. */
  model: string;
  /** Remaining budget for this unit. */
  allowanceCents: number;
}

export interface AttemptHandle {
  /** Runner-specific reference: a process id, a session id. Stored as attempts.runner_ref. */
  ref: string;
  /** The branch the attempt commits to: bulletin/<mission>/<unit>-a<n>. */
  branch: string;
  /** Local checkout of that branch, when the runner has one. */
  workdir?: string;
}

export type RunnerEvent =
  | { type: "progress"; text: string }
  | { type: "tool_use"; tool: string; summary: string }
  | { type: "usage"; model: string; usage: Usage; costCents?: number }
  | { type: "done"; ok: boolean; error?: string };

/** Branch name for one attempt of one unit. */
export function attemptBranch(missionId: string, unitId: string, attempt: number): string {
  return `bulletin/${missionId}/${unitId}-a${attempt}`;
}

/** The integration branch for a mission. */
export function integrationBranch(missionId: string): string {
  return `bulletin/${missionId}/integration`;
}
