import { describe, expect, it } from "vitest";
import { afterRed, attemptTier, mergeDecision } from "./merge-policy";

describe("mergeDecision", () => {
  it("open merges on attempt 1 and 2", () => {
    expect(mergeDecision("open", 1)).toBe("merge");
    expect(mergeDecision("open", 2)).toBe("merge");
  });
  it("gated merges on attempt 1, holds after a retry", () => {
    expect(mergeDecision("gated", 1)).toBe("merge");
    expect(mergeDecision("gated", 2)).toBe("hold");
  });
  it("closed never merges automatically", () => {
    expect(mergeDecision("closed", 1)).toBe("hold");
    expect(mergeDecision("closed", 2)).toBe("hold");
  });
});

describe("afterRed", () => {
  it("retries while attempts remain", () => {
    expect(afterRed(1, 3)).toBe("retry");
    expect(afterRed(2, 3)).toBe("retry");
  });
  it("fails at and beyond max", () => {
    expect(afterRed(3, 3)).toBe("fail");
    expect(afterRed(4, 3)).toBe("fail");
  });
});

describe("attemptTier", () => {
  it("uses the unit tier on attempts 1 and 2", () => {
    expect(attemptTier("station", 1, null)).toBe("station");
    expect(attemptTier("station", 2, "tests failed")).toBe("station");
  });
  it("escalates on attempt 3 after a non-scope reason", () => {
    expect(attemptTier("station", 3, "tests failed")).toBe("escalated");
  });
  it("does not escalate after scope reasons", () => {
    expect(attemptTier("station", 3, "out of scope")).toBe("station");
    expect(attemptTier("station", 3, "locked path")).toBe("station");
  });
  it("escalates with a null reason", () => {
    expect(attemptTier("station", 3, null)).toBe("escalated");
  });
  it("stays escalated beyond attempt 3", () => {
    expect(attemptTier("station", 4, "tests failed")).toBe("escalated");
  });
  it("honours overridden options", () => {
    expect(attemptTier("station", 2, "x", { escalateOnAttempt: 2 })).toBe("escalated");
    expect(attemptTier("station", 3, "x", { escalatedTier: "top" })).toBe("top");
    expect(attemptTier("station", 3, "custom", { scopeReasons: ["custom"] })).toBe("station");
    expect(attemptTier("station", 3, "out of scope", { scopeReasons: ["custom"] })).toBe("escalated");
  });
});
