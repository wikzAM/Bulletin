import { describe, expect, it } from "vitest";
import { BulletinEventSchema, EVENT_TYPES, LANES } from "@bulletin/core";
import { EVENT_TYPE_LIST, isLane, parseEvent, parseEventData, parsePlan } from "../lib/guards";

describe("guards", () => {
  it("lists exactly the event types core defines", () => {
    expect([...EVENT_TYPE_LIST].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("accepts exactly the lanes core defines", () => {
    for (const lane of LANES) expect(isLane(lane)).toBe(true);
    expect(isLane("toString")).toBe(false);
    expect(isLane("bogus")).toBe(false);
  });

  it("parses a valid event the same way the core schema does", () => {
    const raw = { id: 3, mission_id: "m1", ts: "2026-11-16T14:00:00.000Z", type: "unit.started" };
    expect(parseEvent(raw)).toEqual(BulletinEventSchema.parse(raw));
    const full = { ...raw, unit_id: "u1", payload: { lane: "open" } };
    expect(parseEvent(full)).toEqual(BulletinEventSchema.parse(full));
  });

  it("parses an SSE data line from docs/API.md and ignores junk", () => {
    const line =
      '{"id":7,"mission_id":"demo","ts":"2026-11-17T14:00:01.000Z","type":"unit.started","unit_id":"seed-data","payload":{"lane":"open"}}';
    expect(parseEventData(line)).toMatchObject({ id: 7, type: "unit.started", unit_id: "seed-data" });
    expect(parseEventData("not json")).toBeNull();
    expect(parseEventData('{"id":1}')).toBeNull();
  });

  it("reads a plan with PlanSchema's defaults and drops units without an id or title", () => {
    const plan = parsePlan({ units: [{ id: "u1", title: "One", needs: [{ unit: "u0" }] }, { id: "u2" }, "x"] });
    expect(plan).toEqual({
      briefing_version: 1,
      units: [{ id: "u1", title: "One", task: "", files: [], needs: [{ unit: "u0", reads: "" }], lane: "open", tier: "station", acceptance: [] }],
    });
    expect(parsePlan({ units: [] })).toBeNull();
    expect(parsePlan("plan")).toBeNull();
  });

  it("rejects what the core schema rejects", () => {
    const base = { id: 1, mission_id: "m1", ts: "x", type: "plan.approved" };
    const bad: unknown[] = [
      null,
      [],
      "text",
      { ...base, id: -1 },
      { ...base, id: 1.5 },
      { ...base, mission_id: "" },
      { ...base, type: "unit.exploded" },
      { ...base, unit_id: 4 },
      { ...base, payload: [] },
    ];
    for (const value of bad) {
      expect(BulletinEventSchema.safeParse(value).success).toBe(false);
      expect(parseEvent(value)).toBeNull();
    }
  });
});
