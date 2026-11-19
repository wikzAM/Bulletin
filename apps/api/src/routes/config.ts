import { fileURLToPath } from "node:url";
import { DEFAULT_LANES, loadModelsConfig, loadPricesConfig, type ModelsConfig, type PricesConfig } from "@bulletin/core";
import type { FastifyInstance } from "fastify";
import { DEFAULT_MISSION_BUDGET_CENTS, DEFAULT_UNIT_ALLOWANCE_CENTS, type ReadBudgetDefaults } from "./mission-ledger";

export interface ConfigSource {
  models: ModelsConfig;
  prices: PricesConfig;
}

function readConfig(): ConfigSource {
  return {
    models: loadModelsConfig(fileURLToPath(new URL("../../../../config/models.json", import.meta.url))),
    prices: loadPricesConfig(fileURLToPath(new URL("../../../../config/prices.json", import.meta.url))),
  };
}

export function registerConfig(app: FastifyInstance, source?: ConfigSource, readBudgetDefaults?: ReadBudgetDefaults): void {
  let config = source;
  app.get("/config", async () => {
    config ??= readConfig();
    const { models, prices } = config;
    const defaults = await readBudgetDefaults?.();
    return {
      roles: Object.fromEntries(Object.entries(models.roles).map(([role, { model, fallback, escalate }]) => [
        role, { model, fallback, escalate },
      ])),
      tiers: models.tiers,
      lanes: DEFAULT_LANES,
      priced_models: Object.keys(prices.models).sort(),
      limits: {
        default_budget_cents: defaults?.budgetCents ?? DEFAULT_MISSION_BUDGET_CENTS,
        unit_allowance_cents: defaults?.unitAllowanceCents ?? DEFAULT_UNIT_ALLOWANCE_CENTS,
      },
    };
  });
}
