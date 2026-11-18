import { describe, expect, it } from "vitest";
import { fareRange } from "./fare-range";

describe("fareRange", () => {
  it("is the low end and 1.8 times it, rounded up to a whole cent", () => {
    expect(fareRange(100)).toEqual({ lowCents: 100, highCents: 180 });
    expect(fareRange(7)).toEqual({ lowCents: 7, highCents: 13 }); // 12.6 rounds up
  });

  it("takes another multiplier", () => {
    expect(fareRange(50, 2)).toEqual({ lowCents: 50, highCents: 100 });
  });

  it("does not let float noise add a cent", () => {
    expect(fareRange(10, 1.1)).toEqual({ lowCents: 10, highCents: 11 }); // 11.000000000000002 before rounding
  });

  it("is zero for zero, and never lets the high end fall below the low end", () => {
    expect(fareRange(0)).toEqual({ lowCents: 0, highCents: 0 });
    expect(fareRange(10, 0.5)).toEqual({ lowCents: 10, highCents: 10 });
  });

  it("rejects a negative or non-finite estimate", () => {
    expect(() => fareRange(-1)).toThrow();
    expect(() => fareRange(Number.NaN)).toThrow();
  });
});
