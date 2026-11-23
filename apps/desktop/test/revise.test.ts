import { describe, expect, it } from "vitest";
import { toReviseResult } from "../src/lib/api-adapters";
import { mockReviseMission } from "../src/lib/mock";
import { reviseMessage, revisionSpent } from "../src/lib/plan-review";

const plan = {
  units: [
    { id: "a", title: "First task", lane: "open", needs: [] },
    { id: "b", title: "Second task", lane: "gated", needs: [{ unit: "a" }] },
  ],
};

describe("toReviseResult (POST /missions/:id/revise)", () => {
  it("turns the replacement plan into the tasks to approve, in batches", () => {
    const result = toReviseResult(200, { mission_id: "m1", attempts: 1, plan });
    expect(result).toEqual({
      ok: true,
      units: [
        { id: "a", title: "First task", lane: "open", wave: 1, needs: [] },
        { id: "b", title: "Second task", lane: "gated", wave: 2, needs: ["a"] },
      ],
    });
  });

  it("throws when a 200 carries no usable plan, so the page shows its failure message", () => {
    expect(() => toReviseResult(200, { plan: { units: "nope" } })).toThrow();
    expect(() => toReviseResult(200, null)).toThrow();
  });

  it("maps each documented refusal to a reason", () => {
    const refusal = (status: number, error: string) => toReviseResult(status, { error });
    expect(refusal(409, "Mission already revised")).toEqual({ ok: false, reason: "already" });
    expect(refusal(409, "Mission has no plan to revise")).toEqual({ ok: false, reason: "no_plan" });
    expect(refusal(409, "Mission is no longer awaiting approval")).toEqual({ ok: false, reason: "closed" });
    expect(refusal(409, "Mission plan update in progress")).toEqual({ ok: false, reason: "busy" });
    expect(refusal(404, "Mission not found")).toEqual({ ok: false, reason: "not_found" });
    expect(refusal(400, "Invalid request")).toEqual({ ok: false, reason: "invalid" });
    expect(refusal(422, "Mission planning failed")).toEqual({ ok: false, reason: "planning_failed" });
    expect(refusal(503, "Mission planning failed")).toEqual({ ok: false, reason: "planning_failed" });
  });

  it("throws on an unexpected failure", () => {
    expect(() => toReviseResult(500, { error: "Internal server error" })).toThrow(/Internal server error/);
  });
});

describe("revision messages and the one-revision rule", () => {
  it("only a made or already-recorded revision uses up the one allowed revision", () => {
    expect(revisionSpent({ ok: true, units: [] })).toBe(true);
    expect(revisionSpent({ ok: false, reason: "already" })).toBe(true);
    for (const reason of ["no_plan", "closed", "busy", "not_found", "invalid", "planning_failed"] as const) {
      expect(revisionSpent({ ok: false, reason })).toBe(false);
    }
  });

  it("says in plain words what happened", () => {
    expect(reviseMessage({ ok: true, units: [] }).tone).toBe("ok");
    expect(reviseMessage({ ok: false, reason: "planning_failed" })).toEqual({
      tone: "error",
      text: "The plan could not be changed this time. Your first plan is still there, and you can try again.",
    });
  });
});

describe("sample data", () => {
  it("allows one revision per project, then refuses", () => {
    const first = mockReviseMission("no-such-project", "x");
    expect(first).toEqual({ ok: false, reason: "not_found" });
  });
});
