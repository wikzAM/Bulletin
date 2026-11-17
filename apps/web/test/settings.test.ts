import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toSettings } from "../lib/api-adapters";
import { mockSettings } from "../lib/mock";
import { settingsView } from "../lib/settings";

const root = join(__dirname, "..", "..", "..");
const models = JSON.parse(readFileSync(join(root, "config", "models.json"), "utf8")) as {
  roles: Record<string, { model: string; fallback?: string; escalate?: string }>;
  tiers: Record<string, string>;
};

describe("toSettings", () => {
  it("reads roles, tiers, prices and limits", () => {
    const s = toSettings({
      models: { roles: { general: { model: "m-big", fallback: "m-mid" }, answerer: { model: "m-small", escalate: "m-mid" } }, tiers: { station: "m-mid" } },
      prices: { as_of: "2026-11-03", models: { "m-big": { input: 8, output: 40, cache_write: 10, cache_read: 0.2 } } },
      limits: { maxAttempts: 3, parallel: 4 },
      default_budget_cents: 500,
    });
    expect(s).toEqual({
      roles: [
        { role: "general", model: "m-big", fallback: "m-mid", escalate: null },
        { role: "answerer", model: "m-small", fallback: null, escalate: "m-mid" },
      ],
      tiers: [{ tier: "station", model: "m-mid" }],
      prices: [{ model: "m-big", input: 8, output: 40 }],
      pricesAsOf: "2026-11-03",
      limits: { maxAttempts: 3, parallel: 4 },
      defaultBudgetCents: 500,
    });
  });

  it("accepts roles and tiers at the top level and skips what it cannot read", () => {
    const s = toSettings({ roles: { triage: { model: "m-small" }, broken: {} }, tiers: { escalated: "m-big", bad: 3 } });
    expect(s?.roles).toEqual([{ role: "triage", model: "m-small", fallback: null, escalate: null }]);
    expect(s?.tiers).toEqual([{ tier: "escalated", model: "m-big" }]);
    expect(s).toMatchObject({ prices: [], pricesAsOf: null, limits: {}, defaultBudgetCents: null });
  });

  it("is null when there is nothing to show", () => {
    expect(toSettings(null)).toBeNull();
    expect(toSettings({ error: "Route not found" })).toBeNull();
  });
});

describe("settingsView", () => {
  it("describes each job in plain words, with fallbacks", () => {
    const view = settingsView(toSettings({ models: models })!);
    const general = view.jobs.find((j) => j.key === "general");
    expect(general).toMatchObject({ job: "Writes the plan", model: models.roles.general?.model });
    expect(general?.note).toBe(`Falls back to ${models.roles.general?.fallback}`);
    const answerer = view.jobs.find((j) => j.key === "answerer");
    expect(answerer?.note).toBe(`Asks ${models.roles.answerer?.escalate} when unsure`);
    expect(view.jobs.map((j) => j.key)).toEqual(Object.keys(models.roles));
    expect(view.tiers.map((t) => t.label)).toEqual(["Most tasks", "Tasks that need a stronger model"]);
  });

  it("names an unknown job by its key", () => {
    const view = settingsView({ roles: [{ role: "code_review", model: "m", fallback: null, escalate: null }], tiers: [], prices: [], pricesAsOf: null, limits: {}, defaultBudgetCents: null });
    expect(view.jobs[0]).toMatchObject({ job: "Code review", note: null });
  });

  it("lists the spend limits first, then the other limits it knows", () => {
    const view = settingsView({ roles: [], tiers: [], prices: [], pricesAsOf: null, limits: { maxAttempts: 3, parallel: 4, mystery: 9 }, defaultBudgetCents: 500 });
    expect(view.limits).toEqual([
      { label: "Default budget per project", value: "$5.00" },
      { label: "Warning shown at", value: "80% of the budget" },
      { label: "Tries per task", value: "3" },
      { label: "Tasks worked on at once", value: "4" },
    ]);
  });
});

describe("mock settings", () => {
  it("come from config/, so model names are never written in code", () => {
    const s = toSettings(mockSettings());
    expect(s?.roles.map((r) => [r.role, r.model])).toEqual(Object.entries(models.roles).map(([role, r]) => [role, r.model]));
    expect(s?.prices.length).toBeGreaterThan(0);
  });
});
