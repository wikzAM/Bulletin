import { describe, expect, it } from "vitest";
import type { BulletinEvent, EventType } from "@bulletin/core";
import {
  REPLAY_DURATION_MS,
  frameAt,
  replaySchedule,
  type ReplayControls,
} from "../src/lib/replay";

let nextId = 1;
function ev(type: EventType, unitId: string | null = null): BulletinEvent {
  return {
    id: nextId++,
    mission_id: "m1",
    ts: `2026-11-18T12:00:${String(nextId).padStart(2, "0")}.000Z`,
    type,
    unit_id: unitId,
    payload: {},
  };
}

describe("replaySchedule", () => {
  it("compresses events into about 30 seconds of playback", () => {
    const events = [ev("plan.approved"), ev("unit.started", "a"), ev("mission.finished")];
    const schedule = replaySchedule(events);
    expect(schedule.durationMs).toBe(REPLAY_DURATION_MS);
    expect(schedule.frames).toHaveLength(3);
    expect(schedule.frames[0]!.atMs).toBe(0);
    expect(schedule.frames.at(-1)!.atMs).toBe(REPLAY_DURATION_MS);
  });

  it("returns the last frame at or before the clock", () => {
    const schedule = replaySchedule([ev("plan.approved"), ev("unit.started", "a"), ev("mission.finished")]);
    expect(frameAt(schedule, 0)?.event.type).toBe("plan.approved");
    expect(frameAt(schedule, REPLAY_DURATION_MS)?.event.type).toBe("mission.finished");
  });
});

describe("ReplayControls", () => {
  it("supports skip, pause and speed without mutating the schedule", () => {
    const controls: ReplayControls = { paused: false, speed: 1, cursorMs: 0 };
    controls.paused = true;
    controls.speed = 2;
    controls.cursorMs = REPLAY_DURATION_MS;
    expect(controls).toEqual({ paused: true, speed: 2, cursorMs: REPLAY_DURATION_MS });
  });
});
