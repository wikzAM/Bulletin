import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LANES } from "@bulletin/core";
import { toSettings } from "../lib/api-adapters";
import { mockSettings } from "../lib/mock";
import { settingsView } from "../lib/settings";
import type { SettingsInfo } from "../lib/types";

const root = join(__dirname, "..", "..", "..");
const models = JSON.parse(readFileSync(join(root, "config", "models.json"), "utf8")) as {
  roles: Record<string, { model: string; fallback?: string; escalate?: string }>;
  tiers: Record<string, string>;
};
const prices = JSON.parse(readFileSync(join(root, "config", "prices.json"), "utf8")) as { models: Record<string, unknown> };

const empty: SettingsInfo = { roles: [], tiers: [], pricedModels: [], lanes: null, defaultBudgetCents: null, unitAllowanceCents: null };

describe("toSettings (GET /config in docs/API.md)", () => {
  it("reads roles, tiers, lanes, priced models and limits", () => {
    const s = toSettings({
      roles: { general: { model: "m-big", fallback: "m-mid" }, answerer: { model: "m-small", escalate: "m-mid" } },
      tiers: { station: "m-mid" },
      lanes: { closed: ["infra/**"], gated: ["**/package.json"] },
      priced_models: ["m-big", "m-mid"],
      limits: { default_budget_cents: 500, unit_allowance_cents: 200 },
    });
    expect(s).toEqual({
      roles: [
        { role: "general", model: "m-big", fallback: "m-mid", escalate: null },
        { role: "answerer", model: "m-small", fallback: null, escalate: "m-mid" },
      ],
      tiers: [{ tier: "station", model: "m-mid" }],
      pricedModels: ["m-big", "m-mid"],
      lanes: { closed: ["infra/**"], gated: ["**/package.json"] },
      defaultBudgetCents: 500,
      unitAllowanceCents: 200,
    });
  });

  it("skips what it cannot read", () => {
    const s = toSettings({ roles: { triage: { model: "m-small" }, broken: {} }, tiers: { escalated: "m-big", bad: 3 }, priced_models: ["m", 4], lanes: "no" });
    expect(s).toEqual({
      ...empty,
      roles: [{ role: "triage", model: "m-small", fallback: null, escalate: null }],
      tiers: [{ tier: "escalated", model: "m-big" }],
      pricedModels: ["m"],
    });
  });

  it("is null when there is nothing to show", () => {
    expect(toSettings(null)).toBeNull();
    expect(toSettings({ error: "Route not found" })).toBeNull();
  });
});

describe("settingsView", () => {
  it("describes each job in plain words, with fallbacks", () => {
    const view = settingsView(toSettings({ roles: models.roles, tiers: models.tiers })!);
    const general = view.jobs.find((j) => j.key === "general");
    expect(general).toMatchObject({ job: "Writes the plan", model: models.roles.general?.model });
    expect(general?.note).toBe(`Falls back to ${models.roles.general?.fallback}`);
    const answerer = view.jobs.find((j) => j.key === "answerer");
    expect(answerer?.note).toBe(`Asks ${models.roles.answerer?.escalate} when unsure`);
    expect(view.jobs.map((j) => j.key)).toEqual(Object.keys(models.roles));
    expect(view.tiers.map((t) => t.label)).toEqual(["Most tasks", "Tasks that need a stronger model"]);
  });

  it("names an unknown job by its key", () => {
    const view = settingsView({ ...empty, roles: [{ role: "code_review", model: "m", fallback: null, escalate: null }] });
    expect(view.jobs[0]).toMatchObject({ job: "Code review", note: null });
  });

  it("lists the spend limits, with the warning share next to the budget", () => {
    expect(settingsView({ ...empty, defaultBudgetCents: 500, unitAllowanceCents: 200 }).limits).toEqual([
      { label: "Default budget per project", value: "$5.00" },
      { label: "Warning shown at", value: "80% of the budget" },
      { label: "Most one task may spend", value: "$2.00" },
    ]);
    expect(settingsView(empty).limits).toEqual([]);
  });

  it("describes the file rules in the same words as the task cards", () => {
    const view = settingsView({ ...empty, lanes: { closed: ["infra/**"], gated: [] } });
    expect(view.lanes).toEqual([
      { key: "closed", label: "Always needs approval", patterns: ["infra/**"] },
      { key: "gated", label: "Added automatically if checks pass on the first try", patterns: [] },
    ]);
    expect(settingsView(empty).lanes).toEqual([]);
  });
});

describe("mock settings", () => {
  it("match GET /config: models from config/, lanes from core", () => {
    const s = toSettings(mockSettings());
    expect(s?.roles.map((r) => [r.role, r.model])).toEqual(Object.entries(models.roles).map(([role, r]) => [role, r.model]));
    expect(s?.pricedModels).toEqual(Object.keys(prices.models).sort());
    expect(s?.lanes).toEqual(DEFAULT_LANES);
    expect(s).toMatchObject({ defaultBudgetCents: 500 });
  });
});
