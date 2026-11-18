import { describe, expect, it } from "vitest";
import { mission, station } from "./test-support";

/*
 * The Bulletin loop end to end with fakes (spec milestone M2): scripted stations talk to the real MCP
 * server and the real answer pipeline; only the model (a scripted rung), the Briefing storage and the
 * event log are fakes. Nothing here needs a network or a key.
 */

describe("the Bulletin loop (spec M2)", () => {
  it("answers from the Briefing, citing the section it came from", async () => {
    const m = mission();
    const s1 = await station(m, "u1");
    const r = await s1.ask("Where does the app keep its data?");
    expect(r).toEqual({
      status: "answered",
      answer: "On the student's machine, in a local SQLite file.",
      source: "briefing",
      briefing_ref: "Constraints",
    });
    expect(m.modelCalls).toHaveLength(1);
  });

  it("serves a second identical ask from the cache with zero model calls, even from another station", async () => {
    const m = mission();
    const s1 = await station(m, "u1");
    const s2 = await station(m, "u2");
    await s1.ask("Where does the app keep its data?");
    expect(m.modelCalls).toHaveLength(1);

    const again = await s2.ask("  where does the app keep ITS data?  ");
    expect(again).toMatchObject({ status: "answered", source: "cache", briefing_ref: "Constraints" });
    expect(m.modelCalls).toHaveLength(1); // no new model call
    expect(m.pipeline.stats).toMatchObject({ cacheHits: 1, modelCalls: 1 });
  });

  it("opens a decision for a question the Briefing cannot answer, and a human answer reaches the waiting station as a new Briefing version", async () => {
    const m = mission();
    const s1 = await station(m, "u1");

    const asked = await s1.ask("Should the export button write CSV or JSON?");
    expect(asked.status).toBe("pending");
    if (asked.status !== "pending") return;

    const opened = m.events.events.filter((e) => e.type === "decision.opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ unit_id: "u1", payload: { dispatch_id: asked.dispatch_id, question: "Should the export button write CSV or JSON?" } });

    // The station is already waiting when the human answers.
    const waiting = s1.wait(asked.dispatch_id, 30);
    await new Promise((r) => setTimeout(r, 20));
    const next = await m.humanAnswers(asked.dispatch_id, "CSV.");
    expect(next.version).toBe(2);

    expect(await waiting).toEqual({ status: "answered", answer: "CSV.", source: "human", briefing_ref: "Decisions log" });

    // The decisions log grew by one line and the Briefing is version 2.
    const text = await s1.briefing();
    const log = text.split("## Decisions log")[1]!;
    expect(log).toContain("- 2026-01-01 picked sqlite");
    expect(log).toContain("Should the export button write CSV or JSON? A: CSV.");
    expect(m.events.events.some((e) => e.type === "briefing.versioned" && e.payload.version === 2)).toBe(true);
    expect(m.events.events.some((e) => e.type === "decision.resolved")).toBe(true);
    expect(await s1.briefing("Decisions log")).toContain("CSV.");
  });

  it("delivers one human answer to every station that asked the same question", async () => {
    const m = mission();
    const s1 = await station(m, "u1");
    const s2 = await station(m, "u2");
    const a = await s1.ask("CSV or JSON for export?");
    const b = await s2.ask("csv or json for export?");
    if (a.status !== "pending" || b.status !== "pending") throw new Error("expected both to be pending");
    expect(m.events.events.filter((e) => e.type === "decision.opened")).toHaveLength(1);

    const w1 = s1.wait(a.dispatch_id);
    const w2 = s2.wait(b.dispatch_id);
    await m.humanAnswers(a.dispatch_id, "CSV.");
    expect(await w1).toMatchObject({ status: "answered", source: "human", answer: "CSV." });
    expect(await w2).toMatchObject({ status: "answered", source: "human", answer: "CSV." });
  });

  it("answers the same question from the cache once a human has settled it, with no further model call", async () => {
    const m = mission();
    const s1 = await station(m, "u1");
    const a = await s1.ask("CSV or JSON for export?");
    if (a.status !== "pending") throw new Error("expected pending");
    await m.humanAnswers(a.dispatch_id, "CSV.");
    const callsBefore = m.modelCalls.length;

    const s3 = await station(m, "u3");
    expect(await s3.ask("CSV or JSON for export?")).toMatchObject({ status: "answered", source: "cache", answer: "CSV." });
    expect(m.modelCalls).toHaveLength(callsBefore);
  });

  it("records questions and answers as dispatches other stations can read", async () => {
    const m = mission();
    const s1 = await station(m, "u1");
    const s2 = await station(m, "u2");
    await s1.ask("Where does the app keep its data?");
    await s1.post("progress", "schema written");
    const seen = await s2.read({ unit_id: "u1" });
    expect(seen).toContain("schema written");
    expect(seen).toContain("Where does the app keep its data?");
  });

  it("flags a bad cut after ten questions in one attempt", async () => {
    const m = mission();
    const s1 = await station(m, "u1");
    for (let i = 0; i < 10; i++) await s1.ask(`where is data ${i}?`);
    const eleventh = await s1.askRaw("where is data 11?");
    expect(eleventh.isError).toBe(true);
    expect(eleventh.text).toMatch(/Question limit/);
    const blockers = (await m.store.readDispatches({ unit_id: "u1" })).filter((d) => d.kind === "blocker");
    expect(blockers).toHaveLength(1);
  });
});
