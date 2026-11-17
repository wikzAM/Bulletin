import { MemoryEventLog } from "@bulletin/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server";

describe("api", () => {
  it("GET /health returns ok", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "api" });
    await app.close();
  });
});

describe("war table API", () => {
  let events: MemoryEventLog;
  let app: ReturnType<typeof buildServer>;

  beforeEach(() => {
    events = new MemoryEventLog();
    app = buildServer(events);
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /missions lists missions in creation order with their current statuses", async () => {
    const empty = await app.inject("/missions");
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ missions: [] });

    const first = await events.emit({
      mission_id: "first",
      type: "mission.created",
      payload: { repo: "/repos/first", base: "main" },
    });
    const second = await events.emit({ mission_id: "second", type: "mission.created" });
    await events.emit({ mission_id: "second", type: "plan.proposed" });
    await events.emit({ mission_id: "first", type: "plan.approved" });
    await events.emit({ mission_id: "first", type: "mission.finished" });

    const res = await app.inject("/missions");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      missions: [
        { id: "first", repo: "/repos/first", base: "main", created_at: first.ts, status: "finished" },
        { id: "second", repo: null, base: null, created_at: second.ts, status: "planning" },
      ],
    });
  });

  it("GET /missions/:id projects units and ledger totals from that mission's events", async () => {
    const mission_id = "demo";
    const created = await events.emit({ mission_id, type: "mission.created" });
    await events.emit({ mission_id, type: "plan.proposed", payload: { units: 3, waves: 2 } });
    await events.emit({ mission_id, type: "plan.approved" });
    await events.emit({ mission_id, type: "wave.started", payload: { wave: 1, units: ["a", "b"] } });
    await events.emit({ mission_id, type: "unit.started", unit_id: "a", payload: { lane: "open" } });
    await events.emit({ mission_id, type: "pass.red", unit_id: "a" });
    await events.emit({ mission_id, type: "unit.sent_back", unit_id: "a" });
    await events.emit({ mission_id, type: "attempt.started", unit_id: "a" });
    await events.emit({ mission_id, type: "pass.green", unit_id: "a" });
    await events.emit({ mission_id, type: "attempt.ended", unit_id: "a", payload: { result: "green" } });
    await events.emit({ mission_id, type: "unit.merged", unit_id: "a" });
    await events.emit({ mission_id, type: "unit.blocked", unit_id: "c" });
    await events.emit({ mission_id, type: "ledger.charged", unit_id: "a", payload: { cost_cents: 0.1 } });
    await events.emit({ mission_id, type: "ledger.charged", payload: { cost_cents: 0.2 } });
    await events.emit({ mission_id, type: "ledger.charged", payload: { cost_cents: "invalid" } });
    await events.emit({ mission_id: "other", type: "ledger.charged", payload: { cost_cents: 100 } });

    const res = await app.inject("/missions/demo");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: mission_id,
      repo: null,
      base: null,
      created_at: created.ts,
      status: "running",
      units: [
        { id: "a", status: "merged", lane: "open", wave: 1 },
        { id: "b", status: "pending", lane: null, wave: 1 },
        { id: "c", status: "blocked", lane: null, wave: null },
      ],
      ledger: { cost_cents: 0.3, charges: 2 },
    });
  });

  it.each(["/missions/missing", "/missions/missing/events"])("GET %s returns 404", async (url) => {
    const res = await app.inject(url);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Mission not found" });
  });

  it.each(["-1", "1.5", "nope", "9007199254740992", "1&after=2"])(
    "rejects an invalid SSE cursor (%s)",
    async (cursor) => {
      await events.emit({ mission_id: "demo", type: "mission.created" });
      const res = await app.inject(`/missions/demo/events?after=${cursor}`);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid event cursor" });
    },
  );

  it.each(["full history", "query cursor", "browser reconnect"])(
    "GET /missions/:id/events follows live events after %s",
    async (mode) => {
      const created = await events.emit({ mission_id: "demo", type: "mission.created" });
      const proposal = await events.emit({ mission_id: "demo", type: "plan.proposed" });
      await events.emit({ mission_id: "other", type: "mission.created" });
      const started = await events.emit({
        mission_id: "demo",
        type: "unit.started",
        unit_id: "a",
        payload: { lane: "open", note: "line 1\nline 2" },
      });
      const url = mode === "full history" ? "/missions/demo/events" : `/missions/demo/events?after=${created.id}`;
      const headers = mode === "browser reconnect" ? { "last-event-id": String(proposal.id) } : {};
      const res = await app.inject({ url, headers, payloadAsStream: true, signal: AbortSignal.timeout(2000) });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");

      const format = (event: typeof created) => `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}`;
      let body = "";
      let liveFrame: string | undefined;
      let closing: Promise<void> | undefined;
      for await (const chunk of res.stream().setEncoding("utf8")) {
        body += chunk;
        if (!liveFrame && body.includes(`${format(started)}\n\n`)) {
          await events.emit({ mission_id: "other", type: "mission.finished" });
          liveFrame = format(await events.emit({ mission_id: "demo", type: "pass.green", unit_id: "a" }));
        }
        if (!closing && liveFrame && body.includes(`${liveFrame}\n\n`)) closing = app.close();
      }
      await closing;

      const history = {
        "full history": [created, proposal, started],
        "query cursor": [proposal, started],
        "browser reconnect": [started],
      }[mode];
      expect(liveFrame).toBeDefined();
      expect(body.split("\n\n").filter((frame) => frame.startsWith("id:"))).toEqual([
        ...history!.map(format),
        liveFrame,
      ]);
    },
  );
});
