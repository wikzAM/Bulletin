import { copy, STATUS_LABELS } from "./copy";
import type { MissionStatus, StopResult } from "./types";
import type { AttemptRecord, Ending, UnitCard, WarTableState } from "./war-table";

/** Stop is offered while the project runs and the stream has not reported the end. */
export function canStop(status: MissionStatus, state: WarTableState): boolean {
  return status === "running" && !state.finished;
}

export function stopMessage(result: StopResult): { tone: "ok" | "error"; text: string } {
  const t = copy.stop;
  if (result.ok) return { tone: "ok", text: t.ok };
  switch (result.reason) {
    case "not_running":
      return { tone: "ok", text: t.notRunning };
    case "not_found":
      return { tone: "error", text: t.notFound };
    case "unavailable":
      return { tone: "error", text: t.unavailable };
  }
}

/** A card's label, corrected when the project ended early: nothing is still working or waiting then. */
export function cardStatus(unit: UnitCard, ending: Ending | null): { label: string; icon: string } {
  if (ending && ending !== "done") {
    if (unit.status === "running" || unit.status === "red") return copy.missionPage.cutShort;
    if (unit.status === "pending") return copy.missionPage.notStarted;
  }
  return STATUS_LABELS[unit.status];
}
export function attemptResultLabel(attempt: AttemptRecord, ending: Ending | null): string {
  const results = copy.missionPage.history.results;
  if (attempt.result) return results[attempt.result];
  return ending && ending !== "done" ? results.unfinished : results.none;
}