import { describe, expect, it } from "vitest";
import type { PricesConfig, Usage } from "@bulletin/core";
import { cacheReadShare, capCheck, costCents, fareEstimate } from "./treasury";

const prices: PricesConfig = {
  currency: "USD",
  unit: "per_million_tokens",
  as_of: "2000-01-01",
  models: {
    "model-a": { input: 10, output: 20, cache_write: 12, cache_read: 1 },
    "model-b": { input: 2, output: 4, cache_write: 3, cache_read: 0.5 },
  },
};
const tiers = { station: "model-a", cheap: "model-b" };
const usage = (p: Partial<Usage>): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  ...p,
});

describe("costCents", () => {
  it("prices input tokens", () => {
    expect(costCents("model-a", usage({ input_tokens: 1_000_000 }), prices)).toBe(1000);
  });
  it("prices output tokens", () => {
    expect(costCents("model-a", usage({ output_tokens: 1_000_000 }), prices)).toBe(2000);
  });
  it("prices cache reads", () => {
    expect(costCents("model-a", usage({ cache_read_tokens: 1_000_000 }), prices)).toBe(100);
  });
  it("prices cache writes", () => {
    expect(costCents("model-a", usage({ cache_write_tokens: 1_000_000 }), prices)).toBe(1200);
  });
  it("sums all four kinds", () => {
    const u = {
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_read_tokens: 2_000_000,
      cache_write_tokens: 250_000,
    };
    expect(costCents("model-a", u, prices)).toBe(1000 + 1000 + 200 + 300);
  });
  it("rounds to 4 decimal places", () => {
    // 1 token at model-a input: 0.001 cents exactly; 3 tokens at 2 $/M: 0.0006
    expect(costCents("model-a", usage({ input_tokens: 1 }), prices)).toBe(0.001);
    expect(costCents("model-b", usage({ input_tokens: 3 }), prices)).toBe(0.0006);
    // 1 token at 0.5 $/M = 0.00005 cents, rounds to 0.0001 (half up)
    expect(costCents("model-b", usage({ cache_read_tokens: 1 }), prices)).toBe(0.0001);
    // 1 token at 1 $/M = 0.0001 cents
    expect(costCents("model-a", usage({ cache_read_tokens: 1 }), prices)).toBe(0.0001);
    // 1 token at 3 $/M = 0.0003; 1 token at 2 $/M = 0.0002
    expect(costCents("model-b", usage({ cache_write_tokens: 1, input_tokens: 0 }), prices)).toBe(0.0003);
    expect(costCents("model-b", usage({ input_tokens: 1 }), prices)).toBe(0.0002);
  });
  it("throws naming an unknown model", () => {
    expect(() => costCents("model-zzz", usage({}), prices)).toThrow(/model-zzz/);
  });
});

describe("fareEstimate", () => {
  it("uses an explicit estimate", () => {
    const f = fareEstimate(
      [{ id: "u1", tier: "station", estimate: { input_tokens: 100_000, output_tokens: 0 } }],
      tiers,
      prices,
    );
    expect(f.perUnit).toEqual({ u1: 100 });
  });
  it("uses the default estimate when a unit has none", () => {
    const f = fareEstimate([{ id: "u1", tier: "station" }], tiers, prices);
    // 200000 * 10 + 30000 * 20 = 2.6M -> 260 cents; 260 * 1.15 = 299 exactly
    expect(f.perUnit["u1"]).toBe(260);
    expect(f.lowCents).toBe(299);
    expect(f.highCents).toBe(Math.ceil(299 * 1.8));
  });
  it("prices units on different tiers", () => {
    const est = { input_tokens: 1_000_000, output_tokens: 0 };
    const f = fareEstimate(
      [
        { id: "a", tier: "station", estimate: est },
        { id: "b", tier: "cheap", estimate: est },
      ],
      tiers,
      prices,
    );
    expect(f.perUnit).toEqual({ a: 1000, b: 200 });
    expect(f.lowCents).toBe(1380);
  });
  it("throws naming an unknown tier", () => {
    expect(() => fareEstimate([{ id: "a", tier: "nope" }], tiers, prices)).toThrow(/nope/);
  });
  it("honours custom options", () => {
    const f = fareEstimate([{ id: "a", tier: "station" }], tiers, prices, {
      overhead: 0,
      highMultiplier: 2,
      defaultEstimate: { input_tokens: 100_000, output_tokens: 0 },
    });
    expect(f.perUnit).toEqual({ a: 100 });
    expect(f.lowCents).toBe(100);
    expect(f.highCents).toBe(200);
  });
  it("does not add a cent for float noise on whole-cent results", () => {
    const f = fareEstimate(
      [{ id: "a", tier: "station", estimate: { input_tokens: 100_000, output_tokens: 0 } }],
      tiers,
      prices,
    );
    expect(f.lowCents).toBe(115);
    expect(f.highCents).toBe(207);
  });
});

describe("capCheck", () => {
  it("is ok under budget", () => {
    expect(
      capCheck({ budgetCents: 100, spentCents: 10, reservedCents: 20, nextEstimateCents: 30 }),
    ).toEqual({ ok: true, shortfallCents: 0 });
  });
  it("is ok exactly at budget", () => {
    expect(
      capCheck({ budgetCents: 100, spentCents: 50, reservedCents: 25, nextEstimateCents: 25 }),
    ).toEqual({ ok: true, shortfallCents: 0 });
  });
  it("reports the shortfall when over, counting reserved", () => {
    expect(
      capCheck({ budgetCents: 100, spentCents: 50, reservedCents: 40, nextEstimateCents: 30 }),
    ).toEqual({ ok: false, shortfallCents: 20 });
  });
});

describe("cacheReadShare", () => {
  it("computes the share over mixed usages", () => {
    const s = cacheReadShare([
      usage({ input_tokens: 100, cache_read_tokens: 300, cache_write_tokens: 100 }),
      usage({ input_tokens: 100, cache_read_tokens: 100, cache_write_tokens: 100 }),
    ]);
    expect(s).toBeCloseTo(400 / 800);
  });
  it("ignores output tokens", () => {
    expect(
      cacheReadShare([usage({ input_tokens: 50, cache_read_tokens: 50, output_tokens: 99999 })]),
    ).toBe(0.5);
  });
  it("is 0 for an empty list", () => {
    expect(cacheReadShare([])).toBe(0);
  });
  it("is 0 when everything is zero", () => {
    expect(cacheReadShare([usage({ output_tokens: 10 }), usage({})])).toBe(0);
  });
});
