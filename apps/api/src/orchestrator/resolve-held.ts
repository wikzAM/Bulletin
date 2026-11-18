import { join } from "node:path";
import { PlanSchema, type BulletinEvent, type EventSink, type UnitStatus } from "@bulletin/core";
import { dependentsOf } from "@bulletin/graph";
import { integrationBranch } from "@bulletin/runners";
import { checkoutWorktree, removeWorktree, tryGit } from "@bulletin/runners/git";
import { runMission, type MissionOptions, type MissionReport } from "./run-mission";

export type HeldResolution = "approve" | "reject";

export interface ResolveHeldOptions extends Omit<MissionOptions, "events" | "resume" | "signal"> {
  /** The held unit the human decided on. */
  unitId: string;
  resolution: HeldResolution;
  /** This mission's events so far, oldest first. The decision.resolved event may already be in it. */
  history: readonly BulletinEvent[];
  /** Where unit.merged, unit.failed and the continuation's events go. */
  events: EventSink;
  /** Stops the continuation (running dependents) like it stops a mission. */
  signal?: AbortSignal;
}

export type ResolveHeldResult =
  /** The unit is merged. `unblocked` ran as a continuation (its report is in `report`) unless the mission had been stopped. */
  | { outcome: "merged"; unblocked: string[]; statuses: Record<string, UnitStatus>; report?: MissionReport }
  | { outcome: "rejected"; statuses: Record<string, UnitStatus> }
  /** The held branch no longer merges into the integration branch. Nothing changed; the unit stays held. */
  | { outcome: "conflict" }
  /** The unit is not held (never was, or already resolved). */
  | { outcome: "not_held" }
  /** The mission has not finished, so the engine still owns the integration branch. Try again later. */
  | { outcome: "mission_running" };

/** Rebuild unit statuses from the event log. A unit with no unit.* event is pending (absent here). */
export function statusesFromEvents(history: readonly BulletinEvent[]): Record<string, UnitStatus> {
  const byType: Partial<Record<BulletinEvent["type"], UnitStatus>> = {
    "unit.started": "running",
    "unit.merged": "merged",
    "unit.held": "held",
    "unit.failed": "failed",
    "unit.blocked": "blocked",
  };
  const statuses: Record<string, UnitStatus> = {};
  for (const event of history) {
    const status = byType[event.type];
    if (status && event.unit_id) statuses[event.unit_id] = status;
  }
  return statuses;
}

/** One resolution at a time per mission: they all need the integration branch checked out. */
const chains = new Map<string, Promise<unknown>>();
function oneAtATimePerMission<T>(missionId: string, task: () => Promise<T>): Promise<T> {
  const next = (chains.get(missionId) ?? Promise.resolve()).then(task, task);
  const tail = next.catch(() => undefined);
  chains.set(missionId, tail);
  void tail.then(() => {
    if (chains.get(missionId) === tail) chains.delete(missionId);
  });
  return next;
}

/**
 * Act on a human's decision about a unit the engine held (spec section 11). The mission has
 * finished by then: held units were left unmerged and their dependents blocked.
 *
 * - approve: merge the unit's green branch into the integration branch, emit unit.merged, then
 *   run the units that were waiting on it as a continuation of the same mission (same
 *   integration branch, statuses rebuilt from the log, spend and wave count carried over). A
 *   dependent that also waits on a unit that failed or is still held stays blocked.
 * - reject: emit unit.failed with reason "rejected". Dependents stay blocked.
 *
 * It does not emit decision.resolved; the route that took the human's answer does.
 */
export function resolveHeld(options: ResolveHeldOptions): Promise<ResolveHeldResult> {
  return oneAtATimePerMission(options.missionId, () => resolve(options));
}

async function resolve(options: ResolveHeldOptions): Promise<ResolveHeldResult> {
  const { missionId, repo, unitId, events } = options;
  const history = options.history.filter((e) => e.mission_id === missionId);
  const emit = (type: Parameters<EventSink["emit"]>[0]["type"], payload: Record<string, unknown> = {}) =>
    events.emit({ mission_id: missionId, type, unit_id: unitId, payload });

  const finished = history.findLast((e) => e.type === "mission.finished");
  if (!finished) return { outcome: "mission_running" };
  const statuses = statusesFromEvents(history);
  if (statuses[unitId] !== "held") return { outcome: "not_held" };

  if (options.resolution === "reject") {
    await emit("unit.failed", { reason: "rejected" });
    statuses[unitId] = "failed";
    return { outcome: "rejected", statuses };
  }

  const heldEvent = history.findLast((e) => e.type === "unit.held" && e.unit_id === unitId);
  const branch = heldEvent?.payload.branch;
  if (typeof branch !== "string" || !branch) throw new Error(`no branch recorded for held unit ${unitId}`);
  const attempt = heldEvent?.payload.attempt;
  const exists = await tryGit(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
  if (exists.code !== 0) throw new Error(`branch ${branch} of held unit ${unitId} no longer exists`);

  const integ = integrationBranch(missionId);
  const dir = join(options.scratchDir, `resolve-${unitId}`);
  await checkoutWorktree(repo, dir, integ);
  let merged: boolean;
  try {
    const title = PlanSchema.parse(options.plan).units.find((u) => u.id === unitId)?.title ?? unitId;
    const r = await tryGit(dir, "merge", "--no-ff", "-q", "-m", `ship ${unitId}: ${title}`, branch);
    if (r.code !== 0) await tryGit(dir, "merge", "--abort");
    merged = r.code === 0;
  } finally {
    await removeWorktree(repo, dir);
  }
  if (!merged) return { outcome: "conflict" };

  await emit("unit.merged", { attempt, approved: true });
  statuses[unitId] = "merged";

  // A stopped or budget-paused mission does not start new work just because a human approved something.
  const halted = finished.payload.stopped === true || finished.payload.paused === true;
  const plan = PlanSchema.parse(options.plan);
  const stuck = new Set(
    plan.units.flatMap((u) => (statuses[u.id] === "failed" || statuses[u.id] === "held" ? dependentsOf(plan, u.id) : [])),
  );
  const unblocked = halted
    ? []
    : dependentsOf(plan, unitId).filter((id) => statuses[id] === "blocked" && !stuck.has(id));
  if (unblocked.length === 0) return { outcome: "merged", unblocked, statuses };

  for (const id of unblocked) statuses[id] = "pending";
  const spentCents = history.reduce((sum, e) => {
    const cost = e.payload.cost_cents;
    return e.type === "ledger.charged" && typeof cost === "number" ? sum + cost : sum;
  }, 0);
  const report = await runMission({
    ...options,
    resume: { statuses, spentCents, wave: history.filter((e) => e.type === "wave.started").length },
  });
  return { outcome: "merged", unblocked, statuses: report.statuses, report };
}

