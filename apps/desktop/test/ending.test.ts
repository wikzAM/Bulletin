import { describe, expect, it } from "vitest";
import type { BulletinEvent, EventType } from "@bulletin/core";
import { toMissionSummaries, toStopResult } from "../src/lib/api-adapters";
import { copy } from "../src/lib/copy";
import { attemptResultLabel, canStop, cardStatus, stopMessage } from "../src/lib/ending";
import { demoScenario, demoState } from "../src/lib/fixtures";
import { mockMissions, mockStopMission } from "../src/lib/mock";
import type { MissionStatus, PlannedUnit } from "../src/lib/types";
import { describeEvent, reduceEvents } from "../src/lib/war-table";

const units: PlannedUnit[] = [{ id: "u1", title: "Store", lane: "open", wave: 1, needs: [] }];

let nextId = 1;
function ev(type: EventType, payload: Record<string, unknown> = {}): BulletinEvent {
  return { id: nextId++, mission_id: "m1", ts: "2026-11-17T08:00:00.000Z", type, unit_id: null, payload };
}

describe("how a project ended", () => {
  it("is null until mission.finished arrives", () => {
    expect(reduceEvents(units, [ev("plan.approved")]).ending).toBeNull();
  });

  it("reads stopped, interrupted and failed from the payload, and done otherwise", () => {
    expect(reduceEvents(units, [ev("mission.finished", { stopped: true })]).ending).toBe("stopped");
    expect(reduceEvents(units, [ev("mission.finished", { interrupted: true })]).ending).toBe("interrupted");
    expect(reduceEvents(units, [ev("mission.finished", { status: "failed", error: "Mission execution failed" })]).ending).toBe("failed");
    expect(reduceEvents(units, [ev("mission.finished", { shipped: 1 })]).ending).toBe("done");
  });

  it("says how it ended in the activity feed", () => {
    const say = (payload: Record<string, unknown>) => describeEvent({ type: "mission.finished", unit_id: null, payload }, {});
    expect(say({})).toBe("Project finished");
    expect(say({ stopped: true })).toBe("Project stopped by a person");
    expect(say({ interrupted: true })).toBe("Project interrupted: the server restarted before it finished");
    expect(say({ status: "failed" })).toBe("Project failed");
  });
});

describe("task labels after the project ended early", () => {
  it("say a running task was stopped and a waiting one never started", () => {
    const s = reduceEvents(
      [...units, { id: "u2", title: "List", lane: "open", wave: 2, needs: ["u1"] }],
      [ev("plan.approved"), { ...ev("attempt.started", { attempt: 1 }), unit_id: "u1" }, ev("mission.finished", { stopped: true })],
    );
    expect(cardStatus(s.units.u1!, s.ending)).toEqual({ label: "Stopped before it finished", icon: "■" });
    expect(cardStatus(s.units.u2!, s.ending)).toEqual({ label: "Not started", icon: "–" });
  });

  it("say a try without a result did not finish, instead of in progress", () => {
    const s = reduceEvents(units, [{ ...ev("attempt.started", { attempt: 1 }), unit_id: "u1" }]);
    const attempt = s.units.u1!.history[0]!;
    expect(attemptResultLabel(attempt, null)).toBe("In progress");
    expect(attemptResultLabel(attempt, "interrupted")).toBe("Did not finish");
    expect(attemptResultLabel({ ...attempt, result: "green" }, "interrupted")).toBe("Checks passed");
  });

  it("keep the normal labels while running and after a normal finish", () => {
    const s = reduceEvents(units, [{ ...ev("attempt.started", { attempt: 1 }), unit_id: "u1" }]);
    expect(cardStatus(s.units.u1!, s.ending).label).toBe("Working");
    expect(cardStatus(s.units.u1!, "done").label).toBe("Working");
  });
});

describe("project list statuses", () => {
  it("accepts stopped and interrupted from the API", () => {
    const list = toMissionSummaries({
      missions: [
        { id: "a", status: "interrupted" },
        { id: "b", status: "stopped" },
        { id: "c", status: "finished", stopped: true },
        { id: "d", status: "finished", interrupted: true },
        { id: "e", status: "finished" },
      ],
    });
    expect(list.map((m) => m.status)).toEqual(["interrupted", "stopped", "stopped", "interrupted", "finished"]);
  });

  it("has a label for every status, and failed no longer reads as stopped", () => {
    const all: MissionStatus[] = ["interview", "planning", "running", "finished", "failed", "stopped", "interrupted"];
    for (const s of all) expect(copy.missionStatus[s]).toBeTruthy();
    expect(new Set(all.map((s) => copy.missionStatus[s])).size).toBe(all.length);
  });
});

describe("demo scenarios", () => {
  it("include a stopped and an interrupted project", () => {
    const stopped = demoScenario("stopped");
    const interrupted = demoScenario("interrupted");
    expect(stopped && demoState(stopped).ending).toBe("stopped");
    expect(interrupted && demoState(interrupted).ending).toBe("interrupted");
  });
});

describe("stopping", () => {
  it("is offered while running and not yet finished", () => {
    const running = reduceEvents(units, [ev("plan.approved")]);
    expect(canStop("running", running)).toBe(true);
    expect(canStop("planning", running)).toBe(false);
    expect(canStop("running", reduceEvents(units, [ev("plan.approved"), ev("mission.finished", { stopped: true })]))).toBe(false);
  });

  it("reads the stop route's answers", () => {
    expect(toStopResult(202, { mission_id: "m1", status: "stopping" })).toEqual({ ok: true });
    expect(toStopResult(409, { error: "Mission is not running" })).toEqual({ ok: false, reason: "not_running" });
    expect(toStopResult(404, { error: "Mission not found" })).toEqual({ ok: false, reason: "not_found" });
    expect(toStopResult(404, { error: "Route not found" })).toEqual({ ok: false, reason: "unavailable" });
    expect(() => toStopResult(500, null)).toThrow();
  });

  it("explains each answer in plain words", () => {
    expect(stopMessage({ ok: true })).toEqual({ tone: "ok", text: expect.stringContaining("Stopping") });
    expect(stopMessage({ ok: false, reason: "not_running" }).tone).toBe("ok");
    expect(stopMessage({ ok: false, reason: "unavailable" }).tone).toBe("error");
  });

  it("works in mock mode for a running mock project only", () => {
    const running = mockMissions.find((m) => m.status === "running");
    const other = mockMissions.find((m) => m.status !== "running");
    expect(running && mockStopMission(running.id)).toEqual({ ok: true });
    expect(other && mockStopMission(other.id)).toEqual({ ok: false, reason: "not_running" });
    expect(mockStopMission("missing")).toEqual({ ok: false, reason: "not_found" });
  });
});
