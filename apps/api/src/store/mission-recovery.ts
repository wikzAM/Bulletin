import type { EventLog } from "./event-log";

export async function recoverInterruptedMissions(log: EventLog): Promise<void> {
  const created = new Set<string>();
  const finished = new Set<string>();
  for (const { type, mission_id } of log.events) {
    if (type === "mission.created") created.add(mission_id);
    if (type === "mission.finished") finished.add(mission_id);
  }
  for (const mission_id of created) {
    if (!finished.has(mission_id)) {
      await log.emit({ mission_id, type: "mission.finished", payload: { interrupted: true } });
    }
  }
}
