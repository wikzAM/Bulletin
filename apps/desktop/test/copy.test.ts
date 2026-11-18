import { describe, expect, it } from "vitest";
import { LANES, UNIT_STATUSES } from "@bulletin/core";
import { copy, LANE_LABELS, STATUS_LABELS } from "../src/lib/copy";

describe("copy", () => {
  it("gives every unit status a distinct label and an icon, so color is never the only signal", () => {
    const labels = UNIT_STATUSES.map((s) => STATUS_LABELS[s].label);
    expect(new Set(labels).size).toBe(UNIT_STATUSES.length);
    for (const s of UNIT_STATUSES) expect(STATUS_LABELS[s].icon.trim()).not.toBe("");
    const icons = UNIT_STATUSES.map((s) => STATUS_LABELS[s].icon);
    expect(new Set(icons).size).toBe(UNIT_STATUSES.length);
  });

  it("labels every lane", () => {
    for (const lane of LANES) expect(LANE_LABELS[lane]).toBeTruthy();
  });

  it("gives every budget level a distinct label and an icon", () => {
    const levels = Object.values(copy.treasury.levels);
    expect(new Set(levels.map((l) => l.label)).size).toBe(levels.length);
    for (const l of levels) expect(l.icon.trim()).not.toBe("");
  });

  it("keeps the UI free of the military theme for now", () => {
    const shown: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") shown.push(value);
      else if (typeof value === "function") shown.push(String((value as (...a: unknown[]) => unknown)("x", "y")));
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect([copy, STATUS_LABELS, LANE_LABELS]);
    expect(shown.length).toBeGreaterThan(50);
    const text = shown.join("\n").toLowerCase();
    for (const word of ["war table", "mission", "station", "general", "commander", "dispatch", "wave", "treasury", "courier", "fog"]) {
      expect(text).not.toContain(word);
    }
  });

  it("has a loading, empty and error message for each page", () => {
    expect(copy.states.loading).toBeTruthy();
    expect(copy.states.error.title).toBeTruthy();
    expect(copy.states.error.retry).toBeTruthy();
    expect(copy.states.notFound.title).toBeTruthy();
    expect(copy.missionList.empty).toBeTruthy();
    expect(copy.missionList.emptyAction).toBeTruthy();
    expect(copy.missionPage.activityEmpty).toBeTruthy();
    expect(Object.values(copy.questions.empty).every(Boolean)).toBe(true);
  });
});
