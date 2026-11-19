import { copy } from "./copy";

export interface RestartNoticeState {
  seenLive: boolean;
  notice: string | null;
}

export const initialRestartNotice: RestartNoticeState = { seenLive: false, notice: null };

export type NoticeEvent =
  | { type: "connection"; state: "connecting" | "live" | "reconnecting" }
  | { type: "sidecar"; source: "bulletin://sidecar"; status: string };

const RESTARTED = copy.missionPage.connection.restarted;

/**
 * UI state for a sidecar restart mid-project. The transport resubscribe is the builder's;
 * this only decides when the notice shows and when a live stream clears it.
 */
export function reduceRestartNotice(state: RestartNoticeState, event: NoticeEvent): RestartNoticeState {
  if (event.type === "connection") {
    if (event.state !== "live") return state;
    return { seenLive: true, notice: state.seenLive ? null : state.notice };
  }
  if (event.source === "bulletin://sidecar" && event.status === "started" && state.seenLive) {
    return { ...state, notice: RESTARTED };
  }
  return state;
}
