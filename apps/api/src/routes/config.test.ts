import { fileURLToPath } from "node:url";
import { DEFAULT_LANES, loadModelsConfig, loadPricesConfig, type PricesConfig } from "@bulletin/core";
import { expect, it } from "vitest";
import { buildServer } from "../server";

it("returns model names, lane defaults, and spending limits from the public settings", async () => {
  const models = loadModelsConfig(fileURLToPath(new URL("../../../../config/models.json", import.meta.url)));
  const prices = loadPricesConfig(fileURLToPath(new URL("../../../../config/prices.json", import.meta.url)));
  const app = buildServer();
  try {
    const res = await app.inject("/config");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      roles: models.roles, tiers: models.tiers, lanes: DEFAULT_LANES, priced_models: Object.keys(prices.models).sort(),
      limits: { default_budget_cents: 500, unit_allowance_cents: 200 },
    });
  } finally {
    await app.close();
  }
});

it("filters private configuration fields and exposes price table names only", async () => {
  const models = {
    roles: { general: { model: "z-model", fallback: "a-model", private_field: "sample private data" } },
    tiers: { station: "z-model" },
  };
  const prices: PricesConfig = {
    currency: "USD", unit: "per_million_tokens", as_of: "test",
    models: {
      "z-model": { input: 1, output: 2, cache_read: 0, cache_write: 0 },
      "a-model": { input: 3, output: 4, cache_read: 0, cache_write: 0 },
    },
  };
  const app = buildServer(undefined, { config: { models, prices } });
  try {
    const res = await app.inject("/config");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      roles: { general: { model: "z-model", fallback: "a-model" } }, tiers: models.tiers,
      lanes: DEFAULT_LANES, priced_models: ["a-model", "z-model"],
      limits: { default_budget_cents: 500, unit_allowance_cents: 200 },
    });
  } finally {
    await app.close();
  }
});
