import { MemoryEventLog } from "@bulletin/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server";

describe("GET /missions/:id/treasury", () => {
  let events: MemoryEventLog;
  let app: ReturnType<typeof buildServer>;

  beforeEach(() => {
    events = new MemoryEventLog();
    app = buildServer(events);
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports spend for each known unit and compares the total against the budget", async () => {
    const mission_id = "demo";
    await events.emit({ mission_id, type: "mission.created", payload: { budget_cents: 2 } });
    await events.emit({ mission_id, type: "wave.started", payload: { wave: 1, units: ["first", "second"] } });
    await events.emit({ mission_id, type: "ledger.charged", unit_id: "first", payload: { cost_cents: 0.1 } });
    await events.emit({ mission_id, type: "ledger.charged", unit_id: "first", payload: { cost_cents: 0.2 } });
    await events.emit({ mission_id, type: "ledger.charged", payload: { cost_cents: 2.25 } });
    await events.emit({ mission_id, type: "mission.finished", payload: { cost_cents: 2.55 } });
    await events.emit({ mission_id: "other", type: "ledger.charged", unit_id: "first", payload: { cost_cents: 100 } });

    const res = await app.inject("/missions/demo/treasury");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      mission_id,
      budget_cents: 2,
      cost_cents: 2.55,
      remaining_cents: -0.55,
      charges: 3,
      units: [
        { id: "first", cost_cents: 0.3, charges: 2 },
        { id: "second", cost_cents: 0, charges: 0 },
      ],
    });
  });

  it("returns zero spend and an unknown budget for an engine run without a budget", async () => {
    await events.emit({ mission_id: "demo", type: "mission.created" });
    const res = await app.inject("/missions/demo/treasury");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      mission_id: "demo", budget_cents: null, cost_cents: 0, remaining_cents: null, charges: 0, units: [],
    });
  });

  it("returns 404 for an unknown mission", async () => {
    const res = await app.inject("/missions/missing/treasury");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Mission not found" });
  });
});
