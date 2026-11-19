import type { BulletinEvent } from "@bulletin/core";

export function startsMissionExecution({ type }: BulletinEvent): boolean {
  return type === "plan.approved" || type === "mission.resumed" || type === "wave.started";
}

export function endsMissionExecution({ type }: BulletinEvent): boolean {
  return type === "mission.finished" || type === "mission.interrupted";
}

export function lastMissionExecution(events: readonly BulletinEvent[]): BulletinEvent | undefined {
  return events.findLast((event) => startsMissionExecution(event) || endsMissionExecution(event));
}

export function isInterrupted(event: BulletinEvent | undefined): boolean {
  return event?.type === "mission.interrupted" || (event?.type === "mission.finished" && event.payload.interrupted === true);
}
