import { describe, expect, it } from "vitest";
import {
  canRequestRevision,
  fareRangeCents,
  formatFareRange,
  nextRevisionCount,
} from "../src/lib/plan-review";

describe("fareRangeCents", () => {
  it("shows the estimate as the low end and 1.8x as the high end", () => {
    expect(fareRangeCents(100)).toEqual({ low_cents: 100, high_cents: 180 });
    expect(fareRangeCents(0)).toEqual({ low_cents: 0, high_cents: 0 });
  });

  it("rounds the high end to whole cents", () => {
    expect(fareRangeCents(33).high_cents).toBe(59);
  });
});

describe("formatFareRange", () => {
  it("reads as a plain spending range", () => {
    expect(formatFareRange({ low_cents: 100, high_cents: 180 }, (n) => `${n}¢`)).toBe("About 100¢ to 180¢");
  });
});

describe("one revision rule", () => {
  it("allows exactly one comment-triggered revision", () => {
    expect(canRequestRevision(0)).toBe(true);
    expect(canRequestRevision(1)).toBe(false);
    expect(nextRevisionCount(0)).toBe(1);
    expect(nextRevisionCount(1)).toBe(1);
  });
});
