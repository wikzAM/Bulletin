import { fileURLToPath } from "node:url";
import { MemoryEventLog, PlanSchema } from "@bulletin/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer, type ServerOptions } from "../server";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

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
      { mission_id, type: "mission.created", payload: { goal, repo: expect.any(String), base: expect.any(String), budget_cents: 500 } },
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

describe("POST /missions/:id/revise", () => {
  const mission_id = "demo";
  const revision = { ...proposal, units: [{ ...proposal.units[0]!, title: "Use deterministic seeds" }] };
  const initialPlan = PlanSchema.parse(proposal);
  const comment = "Make seed generation deterministic.";
  let events: MemoryEventLog;
  let app: ReturnType<typeof buildServer> | undefined;

  beforeEach(() => { events = new MemoryEventLog(); });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function seed({ base = "HEAD", withPlan = true } = {}) {
    await events.emit({ mission_id, type: "mission.created", payload: { goal, repo, base } });
    if (withPlan) await events.emit({ mission_id, type: "plan.proposed", payload: { plan: initialPlan, units: 1 } });
  }

  function revise(options: ServerOptions, payload: object = { comment }, id = mission_id) {
    app ??= buildServer(events, options);
    return app.inject({ method: "POST", url: `/missions/${id}/revise`, payload });
  }

  it("validates and records one replacement, using the latest Briefing version", async () => {
    await seed();
    await events.emit({ mission_id, type: "briefing.versioned", payload: { version: 2, markdown: "Keep fixtures local." } });
    const modelCall = vi.fn<(system: string, user: string) => Promise<string>>().mockResolvedValue(JSON.stringify(revision));
    const response = await revise({ modelCall }, { comment: `  ${comment}  ` });
    const plan = { ...PlanSchema.parse(revision), briefing_version: 2 };
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mission_id, plan, attempts: 1 });
    expect(modelCall.mock.calls[0]?.[1]).toContain("Keep fixtures local.");
    expect(modelCall.mock.calls[0]?.[1]).toContain(initialPlan.units[0]!.title);
    expect(modelCall.mock.calls[0]?.[1]).toContain(comment);
    expect(events.events.at(-1)).toMatchObject({
      type: "plan.proposed", mission_id, payload: { plan, units: 1, revision: 1, comment },
    });
    const second = await revise({ modelCall });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "Mission already revised" });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous proposal if validation fails and preserves the comment across retries", async () => {
    await seed();
    const modelCall = vi.fn<(system: string, user: string) => Promise<string>>().mockResolvedValue(JSON.stringify(revision))
      .mockResolvedValueOnce('{"briefing_version":1,"units":[]}')
      .mockResolvedValueOnce('{"briefing_version":1,"units":[]}');
    const response = await revise({ modelCall });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: "Mission planning failed", attempts: 2 });
    expect(modelCall.mock.calls[1]?.[1]).toContain(comment);
    expect(events.events.filter(({ type }) => type === "plan.proposed")).toHaveLength(1);
    expect((await revise({ modelCall })).statusCode).toBe(200);
  });

  it.each(["plan.approved", "mission.finished"] as const)("rejects revisions after %s", async (type) => {
    await seed();
    await events.emit({ mission_id, type });
    const modelCall = vi.fn(async () => JSON.stringify(revision));
    const response = await revise({ modelCall });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Mission is no longer awaiting approval" });
    expect(modelCall).not.toHaveBeenCalled();
  });

  it("handles invalid input, unknown missions, and saved bases that no longer exist", async () => {
    await seed({ base: "missing-bulletin-fixture-ref" });
    const modelCall = vi.fn(async () => JSON.stringify(revision));
    for (const [payload, id, status, error] of [
      [{ comment: "  " }, mission_id, 400, "Invalid request"],
      [{ comment }, "missing", 404, "Mission not found"],
      [{ comment }, mission_id, 422, "Repository unavailable"],
    ] as const) {
      const response = await revise({ modelCall }, payload, id);
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error });
    }
    expect(modelCall).not.toHaveBeenCalled();
  });

  it("requires a prior plan and reports a missing General configuration", async () => {
    await seed({ withPlan: false });
    const missing = await revise({});
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ error: "Mission has no plan to revise" });
    await events.emit({ mission_id, type: "plan.proposed", payload: { plan: initialPlan, units: 1 } });
    const unconfigured = await revise({});
    expect(unconfigured.statusCode).toBe(503);
    expect(unconfigured.json()).toMatchObject({ error: "Mission planning failed", attempts: 1 });
    expect(events.events).toHaveLength(2);
  });

  it("serializes revisions and approves the replacement once it is saved", async () => {
    await seed();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let releaseModel!: (output: string) => void;
    const modelOutput = new Promise<string>((resolve) => { releaseModel = resolve; });
    const modelCall = vi.fn(() => {
      notifyStarted();
      return modelOutput;
    });
    const startMission = vi.fn<NonNullable<ServerOptions["startMission"]>>(async () => {});
    const first = revise({ modelCall, startMission }).then((response) => response);
    try {
      expect(await Promise.race([started.then(() => true), first.then(() => false)])).toBe(true);
      const approval = app!.inject({ method: "POST", url: `/missions/${mission_id}/approve` });
      const [duplicate, premature] = await Promise.all([revise({ modelCall }), approval]);
      for (const response of [duplicate, premature]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: "Mission plan update in progress" });
      }
    } finally {
      releaseModel(JSON.stringify(revision));
      await first;
    }
    expect((await first).statusCode).toBe(200);
    expect((await app!.inject({ method: "POST", url: `/missions/${mission_id}/approve` })).statusCode).toBe(202);
    expect(startMission).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ plan: PlanSchema.parse(revision) }));
  });
});
