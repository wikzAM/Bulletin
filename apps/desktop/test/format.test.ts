import { describe, expect, it } from "vitest";
import { formatCents, formatPercent } from "../src/lib/format";

describe("formatCents", () => {
  it("shows amounts under a dollar in cents, to at most two decimals", () => {
    expect(formatCents(0)).toBe("0¢");
    expect(formatCents(4.25)).toBe("4.25¢");
    expect(formatCents(13.8)).toBe("13.8¢");
    expect(formatCents(0.0049)).toBe("0¢");
    expect(formatCents(99.994)).toBe("99.99¢");
  });

  it("shows a dollar or more in dollars with two decimals", () => {
    expect(formatCents(99.996)).toBe("$1.00");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(1234.5)).toBe("$12.35");
  });

  it("never shows a negative zero or NaN", () => {
    expect(formatCents(-0)).toBe("0¢");
    expect(formatCents(Number.NaN)).toBe("0¢");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(0.8625)).toBe("86%");
    expect(formatPercent(1.2)).toBe("120%");
    expect(formatPercent(0)).toBe("0%");
  });
});
