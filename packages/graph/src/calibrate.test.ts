import { describe, expect, it } from "vitest";
import { applyCalibration, calibrate, CALIBRATION_MAX, CALIBRATION_MIN } from "./calibrate";

describe("calibrate", () => {
  it("is actual over estimated, per tier", () => {
    const factors = calibrate(
      [
        { unitId: "a", tier: "station", cents: 10 },
        { unitId: "b", tier: "station", cents: 10 },
        { unitId: "c", tier: "escalated", cents: 40 },
      ],
      [
        { unitId: "a", cents: 15 },
        { unitId: "b", cents: 5 },
        { unitId: "c", cents: 60 },
      ],
    );
    expect(factors).toEqual({ station: 1, escalated: 1.5 });
  });

  it("adds up several actual rows for one unit (retries, send-backs)", () => {
    const factors = calibrate([{ unitId: "a", tier: "station", cents: 10 }], [
      { unitId: "a", cents: 8 },
      { unitId: "a", cents: 7 },
    ]);
    expect(factors).toEqual({ station: 1.5 });
  });

  it("leaves out a tier with nothing to compare, and ignores spend on units that had no estimate", () => {
    const factors = calibrate(
      [
        { unitId: "a", tier: "station", cents: 10 },
        { unitId: "b", tier: "escalated", cents: 20 },
      ],
      [
        { unitId: "a", cents: 20 },
        { unitId: "zzz", cents: 999 },
      ],
    );
    expect(factors).toEqual({ station: 2 });
  });

  it("leaves out a tier whose estimate is zero instead of dividing by it", () => {
    expect(calibrate([{ unitId: "a", tier: "station", cents: 0 }], [{ unitId: "a", cents: 5 }])).toEqual({});
  });

  it("keeps one wild mission from swinging the next fare estimate", () => {
    const tooHigh = calibrate([{ unitId: "a", tier: "station", cents: 1 }], [{ unitId: "a", cents: 1000 }]);
    const tooLow = calibrate([{ unitId: "a", tier: "station", cents: 1000 }], [{ unitId: "a", cents: 1 }]);
    expect(tooHigh.station).toBe(CALIBRATION_MAX);
    expect(tooLow.station).toBe(CALIBRATION_MIN);
  });

  it("returns nothing for no data", () => {
    expect(calibrate([], [])).toEqual({});
  });
});

describe("applyCalibration", () => {
  it("scales each unit's estimate by its tier's factor and leaves other tiers alone", () => {
    const scaled = applyCalibration(
      { a: 10, b: 20, c: 5 },
      { a: "station", b: "escalated", c: "station" },
      { station: 1.5 },
    );
    expect(scaled).toEqual({ a: 15, b: 20, c: 7.5 });
  });

  it("does not change its input", () => {
    const perUnit = { a: 10 };
    applyCalibration(perUnit, { a: "station" }, { station: 2 });
    expect(perUnit).toEqual({ a: 10 });
  });
});
