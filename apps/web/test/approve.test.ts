import { describe, expect, it } from "vitest";
import { toApproveResult } from "../lib/api-adapters";
import { approveMessage, canApprove } from "../lib/approve";
import { initialState, reduceEvents } from "../lib/war-table";

describe("toApproveResult", () => {
  it("is ok on 202", () => {
    expect(toApproveResult(202, { mission_id: "m", status: "running" })).toEqual({ ok: true });
  });

  it("keeps the cost-guard numbers when the plan is over budget", () => {
    const body = { error: "Plan exceeds mission budget", budget_cents: 500, estimated_cents: 1150, spent_cents: 10, shortfall_cents: 660 };
    expect(toApproveResult(409, body)).toEqual({
      ok: false,
      reason: "over_budget",
      budget_cents: 500,
      estimated_cents: 1150,
      spent_cents: 10,
      shortfall_cents: 660,
    });
  });

  it("names each documented refusal", () => {
    expect(toApproveResult(409, { error: "Mission already approved" })).toEqual({ ok: false, reason: "already" });
    expect(toApproveResult(409, { error: "Mission has no plan to approve" })).toEqual({ ok: false, reason: "no_plan" });
    expect(toApproveResult(422, { error: "Plan cannot be priced" })).toEqual({ ok: false, reason: "unpriced" });
    expect(toApproveResult(503, { error: "Mission runner not configured" })).toEqual({ ok: false, reason: "not_configured" });
    expect(toApproveResult(503, { error: "Mission pricing not configured" })).toEqual({ ok: false, reason: "not_configured" });
    expect(toApproveResult(404, { error: "Mission not found" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("throws on anything else, so the page shows a retry message", () => {
    expect(() => toApproveResult(500, { error: "Internal server error" })).toThrow("Internal server error");
    expect(() => toApproveResult(409, null)).toThrow("409");
  });
});

describe("approveMessage", () => {
  it("explains the budget shortfall in plain words", () => {
    const m = approveMessage({ ok: false, reason: "over_budget", budget_cents: 500, estimated_cents: 1150, spent_cents: 10, shortfall_cents: 660 });
    expect(m.tone).toBe("error");
    expect(m.text).toBe(
      "This plan is estimated to cost at least $11.50. With 10¢ already spent, that is $6.60 more than the $5.00 budget. Raise the budget or make the plan smaller, then approve again.",
    );
  });

  it("leaves out spending when nothing has been spent", () => {
    const m = approveMessage({ ok: false, reason: "over_budget", budget_cents: 50, estimated_cents: 80, spent_cents: 0, shortfall_cents: 30 });
    expect(m.text).toBe("This plan is estimated to cost at least 80¢, which is 30¢ more than the 50¢ budget. Raise the budget or make the plan smaller, then approve again.");
  });

  it("has a message for every outcome", () => {
    expect(approveMessage({ ok: true })).toEqual({ tone: "ok", text: "Plan approved. Work is starting." });
    for (const reason of ["already", "no_plan", "unpriced", "not_configured", "not_found"] as const) {
      const m = approveMessage({ ok: false, reason });
      expect(m.text.length).toBeGreaterThan(10);
      expect(m.tone).toBe(reason === "already" ? "ok" : "error");
    }
  });
});

describe("canApprove", () => {
  const planned = [{ id: "a", title: "A", lane: "open" as const, wave: 1, needs: [] }];
  const ev = (id: number, type: "plan.approved" | "mission.finished" | "plan.proposed") => ({
    id,
    mission_id: "m",
    ts: "2026-11-17T10:00:00.000Z",
    type,
    unit_id: null,
    payload: {},
  });

  it("is true only while the project is being planned and has tasks", () => {
    expect(canApprove("planning", initialState(planned))).toBe(true);
    expect(canApprove("planning", initialState([]))).toBe(false);
    expect(canApprove("running", initialState(planned))).toBe(false);
    expect(canApprove("interview", initialState(planned))).toBe(false);
  });

  it("turns off once the stream shows approval or the end of the project", () => {
    expect(canApprove("planning", reduceEvents(planned, [ev(1, "plan.approved")]))).toBe(false);
    expect(canApprove("planning", reduceEvents(planned, [ev(1, "mission.finished")]))).toBe(false);
    expect(canApprove("planning", reduceEvents(planned, [ev(1, "plan.proposed")]))).toBe(true);
  });
});
