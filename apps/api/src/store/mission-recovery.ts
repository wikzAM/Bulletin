import type { BulletinEvent } from "@bulletin/core";
import type { EventLog } from "./event-log";
import { endsMissionExecution, startsMissionExecution } from "./mission-state";

function hasLiveOwner(event: BulletinEvent): boolean {
  const pid = event.payload.owner_pid;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function recoverInterruptedMissions(log: EventLog): Promise<void> {
  const created = new Set<string>();
  const states = new Map<string, BulletinEvent>();
  for (const event of log.events) {
    if (event.type === "mission.created") created.add(event.mission_id);
    if (startsMissionExecution(event) || endsMissionExecution(event)) states.set(event.mission_id, event);
  }
  for (const mission_id of created) {
    const state = states.get(mission_id);
    if (state && (endsMissionExecution(state) || hasLiveOwner(state))) continue;
    await log.emit({ mission_id, type: "mission.interrupted" });
  }
}
