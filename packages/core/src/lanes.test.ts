import { describe, expect, it } from "vitest";
import { DEFAULT_LANES } from "./config";
import { MemoryEventLog } from "./events";
import { matchesAny } from "./glob";
import { computeLane, resolveLane, stricterLane } from "./lanes";
import { PlanSchema } from "./types";

describe("lanes", () => {
  it("picks the stricter lane", () => {
    expect(stricterLane("open", "gated")).toBe("gated");
    expect(stricterLane("closed", "gated")).toBe("closed");
    expect(stricterLane("open", "open")).toBe("open");
  });

  it("computes a lane from the strictest file", () => {
    expect(computeLane(["apps/web/app/login/page.tsx"], DEFAULT_LANES)).toBe("open");
    expect(computeLane(["apps/api/package.json"], DEFAULT_LANES)).toBe("gated");
    expect(computeLane(["src/a.ts", "packages/db/migrations/0001.sql"], DEFAULT_LANES)).toBe("closed");
  });

  it("never lets the General lower a lane", () => {
    expect(resolveLane(["packages/db/migrations/0001.sql"], "open", DEFAULT_LANES)).toBe("closed");
    expect(resolveLane(["src/a.ts"], "gated", DEFAULT_LANES)).toBe("gated");
  });
});

describe("glob", () => {
  it("matches dotfiles and normalises separators", () => {
    expect(matchesAny(".bulletin\\lanes.json", [".bulletin/**"])).toBe(true);
    expect(matchesAny("src/a.ts", [])).toBe(false);
  });
});

describe("schemas", () => {
  it("fills plan defaults", () => {
    const plan = PlanSchema.parse({
      briefing_version: 1,
      units: [{ id: "u1", title: "T", task: "Do it", files: ["src/a.ts"] }],
    });
    expect(plan.units[0]).toMatchObject({ lane: "open", tier: "station", needs: [], acceptance: [] });
  });
});

describe("MemoryEventLog", () => {
  it("assigns increasing ids", async () => {
    const log = new MemoryEventLog();
    await log.emit({ mission_id: "m1", type: "mission.created" });
    const second = await log.emit({ mission_id: "m1", type: "unit.started", unit_id: "u1" });
    expect(second.id).toBe(2);
    expect(log.events).toHaveLength(2);
  });
});
