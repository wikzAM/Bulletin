import type { BulletinEvent } from "@bulletin/core";

/** Spec M6: compress a mission into about half a minute. */
export const REPLAY_DURATION_MS = 30_000;

export interface ReplayFrame {
  atMs: number;
  event: BulletinEvent;
}

export interface ReplaySchedule {
  durationMs: number;
  frames: ReplayFrame[];
}

export interface ReplayControls {
  paused: boolean;
  speed: number;
  cursorMs: number;
}

/** Evenly space events from 0 to REPLAY_DURATION_MS (single event stays at 0). */
export function replaySchedule(events: BulletinEvent[], durationMs = REPLAY_DURATION_MS): ReplaySchedule {
  if (events.length === 0) return { durationMs, frames: [] };
  if (events.length === 1) return { durationMs, frames: [{ atMs: 0, event: events[0]! }] };
  const last = events.length - 1;
  const frames = events.map((event, i) => ({
    atMs: Math.round((i / last) * durationMs),
    event,
  }));
  return { durationMs, frames };
}

export function frameAt(schedule: ReplaySchedule, cursorMs: number): ReplayFrame | null {
  let found: ReplayFrame | null = null;
  for (const frame of schedule.frames) {
    if (frame.atMs <= cursorMs) found = frame;
    else break;
  }
  return found;
}

/** Events visible at the cursor (fog lifts as unit.started arrives). */
export function eventsThrough(schedule: ReplaySchedule, cursorMs: number): BulletinEvent[] {
  return schedule.frames.filter((f) => f.atMs <= cursorMs).map((f) => f.event);
}
