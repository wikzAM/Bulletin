import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryEventLog, type BulletinEvent, type NewEvent } from "@bulletin/core";
import { buildServer } from "../../api/src/server";
import type * as ApiModule from "../lib/api";
import { reduceEvents } from "../lib/war-table";

/*
 * lib/api.ts in real mode against the real API routes (apps/api), booted in-process with a seeded
 * event log and a fake model. Node has no EventSource, so a minimal fetch-based one is installed.
 */

type Listener = (msg: MessageEvent<string>) => void;

class FetchEventSource {
  onopen: (() => void) | null = null;
  onmessage: Listener | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Listener[]>();
  private abort = new AbortController();

  constructor(url: string) {
    void this.run(url);
  }

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close() {
    this.abort.abort();
  }

  private dispatch(type: string, data: string) {
    const msg = { data } as MessageEvent<string>;
    if (type === "message") this.onmessage?.(msg);
    for (const fn of this.listeners.get(type) ?? []) fn(msg);
  }

  private async run(url: string) {
    try {
      const res = await fetch(url, { signal: this.abort.signal, headers: { accept: "text/event-stream" } });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      this.onopen?.();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = "message";
          const data: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (data.length > 0) this.dispatch(type, data.join("\n"));
        }
      }
    } catch {
      if (!this.abort.signal.aborted) this.onerror?.();
    }
  }
}

const M = "demo";
const plan = {
  briefing_version: 1,
  units: [
    { id: "store", title: "Due date in the store", task: "t", files: ["examples/todo-app/src/todos.ts"], needs: [], lane: "gated", tier: "station", acceptance: ["pnpm test"] },
    { id: "tests", title: "Tests for due dates", task: "t", files: ["examples/todo-app/test/todos.test.ts"], needs: [{ unit: "store", reads: "the Todo type" }], lane: "open", tier: "station", acceptance: ["pnpm test"] },
  ],
};

const seed: Omit<NewEvent, "mission_id">[] = [
  { type: "mission.created", payload: { goal: "Due dates for todos", repo: "D:/repo", base: "main", budget_cents: 20 } },
  { type: "plan.proposed", payload: { plan, units: 2 } },
  { type: "plan.approved" },
  { type: "wave.started", payload: { wave: 1, units: ["store"] } },
  { type: "unit.started", unit_id: "store", payload: { lane: "gated" } },
  { type: "attempt.started", unit_id: "store", payload: { attempt: 1 } },
  { type: "ledger.charged", unit_id: "store", payload: { cost_cents: 9.5 } },
  { type: "pass.red", unit_id: "store", payload: { attempt: 1, reason: "tests failed" } },
  { type: "unit.sent_back", unit_id: "store", payload: { attempt: 1, reason: "tests failed" } },
  { type: "attempt.started", unit_id: "store", payload: { attempt: 2 } },
  { type: "ledger.charged", unit_id: "store", payload: { cost_cents: 8 } },
  { type: "pass.green", unit_id: "store", payload: { attempt: 2 } },
  { type: "unit.merged", unit_id: "store", payload: { attempt: 2 } },
];

let app: ReturnType<typeof buildServer>;
let log: MemoryEventLog;
let api: typeof ApiModule;

beforeAll(async () => {
  log = new MemoryEventLog();
  await log.emit({ mission_id: "other", type: "mission.created", payload: { repo: "D:/other" } });
  for (const e of seed) await log.emit({ ...e, mission_id: M });
  app = buildServer(log, {
    modelCall: async (_system, user) =>
      JSON.stringify(user.includes("broken") ? { briefing_version: 1, units: [{ ...plan.units[1], needs: [{ unit: "store", reads: "" }] }] } : plan),
  });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  vi.stubEnv("NEXT_PUBLIC_API_URL", address);
  vi.stubGlobal("EventSource", FetchEventSource);
  vi.resetModules();
  api = await import("../lib/api");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await app.close();
});

describe("lib/api.ts against the real API", () => {
  it("is in real mode", () => {
    expect(api.usingMock).toBe(false);
  });

  it("lists missions", async () => {
    const missions = await api.listMissions();
    expect(missions.map((m) => [m.id, m.status])).toEqual([
      ["other", "interview"],
      [M, "running"],
    ]);
    expect(missions[1]?.goal).toBeTruthy();
  });

  it("gets one mission with its units, and null for an unknown one", async () => {
    const mission = await api.getMission(M);
    expect(mission?.units.map((u) => [u.id, u.lane, u.wave])).toEqual([["store", "gated", 1]]);
    expect(mission).toMatchObject({ units_total: 1, units_done: 1 });
    expect(await api.getMission("nope")).toBeNull();
  });

  it("reads the budget from the treasury route", async () => {
    expect(await api.getTreasury(M)).toEqual({ budget_cents: 20 });
    expect(await api.getTreasury("other")).toBeNull();
  });

  it("lists and answers a question", async () => {
    const created = await app.inject({ method: "POST", url: "/questions", payload: { mission_id: M, unit_id: "store", body: "Include a time?" } });
    expect(created.statusCode).toBe(201);
    const open = await api.listQuestions();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: "open", unit_id: "store", body: "Include a time?", source: null });

    const answered = await api.answerQuestion(open[0]!.id, "Dates only.");
    expect(answered).toMatchObject({ status: "answered", answer: "Dates only.", source: "human" });
    await expect(api.answerQuestion(open[0]!.id, "again")).rejects.toThrow("409");
  });

  it("creates a mission with a valid plan, and reports plan errors", async () => {
    const repo = process.cwd();
    const ok = await api.createMission("Add due dates", repo);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.plan.units.map((u) => u.id)).toEqual(["store", "tests"]);

    const bad = await api.createMission("a broken plan", repo);
    expect(bad).toMatchObject({ ok: false, attempts: 2 });
    if (!bad.ok) expect(bad.errors.join("\n")).toContain("fake edge");

    await expect(api.createMission("Add due dates", "Z:/no/such/repo")).rejects.toThrow("Repository unavailable");
  }, 30_000);

  it("streams the mission's events, then live ones, into the reducer", async () => {
    const replay = log.events.filter((e) => e.mission_id === M);
    const seen: BulletinEvent[] = [];
    const states: string[] = [];
    let stop = () => {};
    const done = new Promise<void>((resolve) => {
      stop = api.subscribeEvents(M, {
        onEvent: (e) => {
          seen.push(e);
          if (seen.length === replay.length) void log.emit({ mission_id: M, type: "unit.started", unit_id: "tests" });
          if (seen.length > replay.length) resolve();
        },
        onState: (s) => states.push(s),
      });
    });
    await done;
    stop();

    expect(states).toContain("live");
    expect(seen.slice(0, replay.length)).toEqual(replay);
    expect(seen.at(-1)).toMatchObject({ mission_id: M, type: "unit.started", unit_id: "tests" });

    const state = reduceEvents([], seen);
    expect(state.units.store).toMatchObject({ title: "Due date in the store", status: "merged", attempts: 2, spent_cents: 17.5, last_reason: "tests failed" });
    expect(state.units.tests).toMatchObject({ title: "Tests for due dates", status: "running", wave: 2 });
  });
});
