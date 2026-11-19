import { describe, expect, it } from "vitest";
import { interpretReport, reportLines, NOT_AVAILABLE_YET } from "../src/lib/report";

const sample = {
  mission_id: "demo",
  shipped: ["seed-data"],
  held: ["review"],
  failed: [],
  blocked: ["publish"],
  attempts: 2,
  model_calls: 2,
  cost_cents: 1.25,
  cost_per_green_unit_cents: 0.625,
  touches: 1,
  touch_rate: 1,
  auto_answer_rate: 0.5,
  elapsed_ms: 12000,
};

describe("interpretReport", () => {
  it("reads the documented report fields", () => {
    const out = interpretReport(200, sample);
    expect(out.kind).toBe("ready");
    if (out.kind !== "ready") return;
    expect(out.report.shipped).toEqual(["seed-data"]);
    expect(out.report.held).toEqual(["review"]);
    expect(out.report.failed).toEqual([]);
    expect(out.report.blocked).toEqual(["publish"]);
    expect(out.report.touches).toBe(1);
    expect(out.report.cost_cents).toBe(1.25);
    expect(out.report.elapsed_ms).toBe(12000);
    expect(out.report.touch_rate).toBe(1);
    expect(out.report.auto_answer_rate).toBe(0.5);
    expect(out.report.cost_per_green_unit_cents).toBe(0.625);
  });

  it("treats an unfinished project as not available yet", () => {
    expect(interpretReport(409, { error: "Mission has not finished" }).kind).toBe("not_available");
  });
});

describe("reportLines", () => {
  it("prints null rates and costs as not available yet", () => {
    const out = interpretReport(200, {
      ...sample,
      touch_rate: null,
      auto_answer_rate: null,
      cost_per_green_unit_cents: null,
      elapsed_ms: null,
    });
    if (out.kind !== "ready") throw new Error("expected a report");
    const lines = reportLines(out.report, (n) => `${n}¢`, (n) => `${Math.round(n * 100)}%`);
    const byLabel = Object.fromEntries(lines.map((line) => [line.label, line.value]));
    expect(byLabel["How often you stepped in"]).toBe(NOT_AVAILABLE_YET);
    expect(byLabel["Answered without you"]).toBe(NOT_AVAILABLE_YET);
    expect(byLabel["Cost per finished task"]).toBe(NOT_AVAILABLE_YET);
    expect(byLabel["Time taken"]).toBe(NOT_AVAILABLE_YET);
    expect(byLabel["Shipped"]).toBe("seed-data");
    expect(byLabel["Spent"]).toBe("1.25¢");
  });
});
