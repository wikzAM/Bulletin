import { fileURLToPath } from "node:url";
import { MemoryEventLog } from "@bulletin/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer, type ServerOptions } from "../server";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const goal = "Seed the demo with test data";
const proposal = {
  briefing_version: 1,
  units: [{ id: "seed", title: "Seed the demo", task: "Add demo data", files: ["src/seed.ts"], acceptance: ["pnpm test"] }],
};

describe("POST /missions", () => {
  let events: MemoryEventLog;
  let app: ReturnType<typeof buildServer> | undefined;

  beforeEach(() => {
    events = new MemoryEventLog();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function create(options?: ServerOptions, payload = { goal, repo }) {
    app = buildServer(events, options);
    return app.inject({ method: "POST", url: "/missions", payload });
  }

  it("runs the General with repository context and records the validated plan", async () => {
    const modelCall = vi.fn<(system: string, user: string) => Promise<string>>()
      .mockResolvedValueOnce("invalid output")
      .mockResolvedValueOnce(JSON.stringify(proposal));
    const res = await create({ modelCall });
    expect(res.statusCode).toBe(201);
    const { mission_id, plan, attempts } = res.json();
    expect(mission_id).toEqual(expect.any(String));
    expect(attempts).toBe(2);
    expect(plan).toEqual({
      ...proposal,
      units: [{ ...proposal.units[0], lane: "open", tier: "station", needs: [] }],
    });
    expect(modelCall).toHaveBeenCalledTimes(2);
    expect(modelCall.mock.calls[0]?.[1]).toContain(goal);
    expect(modelCall.mock.calls[0]?.[1]).toContain("apps/api/src/server.ts");
    expect(modelCall.mock.calls[1]?.[1]).toContain("REVISE THE PREVIOUS PLAN");
    expect(events.events).toMatchObject([
      { mission_id, type: "mission.created", payload: { goal, repo: expect.any(String), base: expect.any(String) } },
      { mission_id, type: "plan.proposed", payload: { plan, units: 1 } },
    ]);
    expect((await app?.inject("/missions"))?.json()).toMatchObject({ missions: [{ id: mission_id, status: "planning" }] });
  });

  it("returns the General's errors after retrying an invalid plan", async () => {
    const modelCall = vi.fn(async () => JSON.stringify({ briefing_version: 1, units: [] }));
    const res = await create({ modelCall });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "Mission planning failed", attempts: 2, errors: [expect.stringContaining("units")] });
    expect(modelCall).toHaveBeenCalledTimes(2);
    expect(events.events).toEqual([]);
  });

  it("reports an unconfigured model without spawning a model process", async () => {
    const res = await create();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Mission planning failed", attempts: 1, errors: ["model call failed: not configured"] });
    expect(events.events).toEqual([]);
  });

  it.each([
    { input: { goal: " ", repo }, status: 400, error: "Invalid request" },
    { input: { goal, repo: `${repo}missing-git-repository` }, status: 422, error: "Repository unavailable" },
  ])("rejects invalid planning input with $status", async ({ input, status, error }) => {
    const modelCall = vi.fn(async () => JSON.stringify(proposal));
    const res = await create({ modelCall }, input);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
    expect(modelCall).not.toHaveBeenCalled();
    expect(events.events).toEqual([]);
  });
});
