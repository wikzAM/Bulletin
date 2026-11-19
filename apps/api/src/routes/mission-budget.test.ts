import { MemoryEventLog, type PricesConfig } from "@bulletin/core";
import { expect, it, vi } from "vitest";
import { buildServer } from "../server";
import type { MissionStarter } from "./mission-approval";

const prices: PricesConfig = {
  currency: "USD", unit: "per_million_tokens", as_of: "test",
  models: { "priced-model": { input: 10, output: 20, cache_write: 0, cache_read: 0 } },
};
const pricing = { prices, tiers: { station: "priced-model" } };

async function missionWithBudget(budget_cents: number, tier = "station") {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  await log.emit({ mission_id, type: "mission.created", payload: { repo: "/repos/demo", base: "main", budget_cents } });
  await log.emit({ mission_id, type: "plan.proposed", payload: { plan: { briefing_version: 1, units: [{
    id: "seed", title: "Seed", task: "Seed data", files: ["src/seed.ts"], tier,
    estimate: { input_tokens: 1_000_000, output_tokens: 0 },
  }] } } });
  await log.emit({ mission_id, type: "ledger.charged", payload: { cost_cents: 10 } });
  await log.emit({ mission_id: "another", type: "ledger.charged", payload: { cost_cents: 500 } });
  return log;
}

it("rejects a priced plan over budget before approval or runner startup", async () => {
  const log = await missionWithBudget(500);
  const startMission = vi.fn(async () => {});
  const app = buildServer(log, { startMission, pricing });
  try {
    const res = await app.inject({ method: "POST", url: "/missions/demo/approve" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: "Plan exceeds mission budget", budget_cents: 500, estimated_cents: 1150, spent_cents: 10, shortfall_cents: 660,
    });
    expect(startMission).not.toHaveBeenCalled();
    expect(log.events.some(({ type }) => type === "plan.approved")).toBe(false);
    expect((await app.inject("/missions/demo")).json()).toMatchObject({ status: "planning" });
  } finally {
    await app.close();
  }
});

it("approves an exact fit including prior mission spend", async () => {
  const log = await missionWithBudget(1160);
  const startMission = vi.fn(async () => {});
  const app = buildServer(log, { startMission, pricing });
  try {
    const res = await app.inject({ method: "POST", url: "/missions/demo/approve" });
    expect(res.statusCode).toBe(202);
    expect(startMission).toHaveBeenCalledTimes(1);
    expect(log.events.at(-1)?.type).toBe("plan.approved");
  } finally {
    await app.close();
  }
});

it("passes the saved mission budget to the runner and projects a budget pause in both mission views", async () => {
  const log = await missionWithBudget(1160);
  const startMission = vi.fn<MissionStarter>(async ({ missionId: mission_id, events, budgetCents }) => {
    await events.emit({ mission_id, type: "budget.paused", payload: { budget_cents: budgetCents } });
    await events.emit({ mission_id, type: "mission.finished", payload: { paused: true } });
  });
  const app = buildServer(log, { startMission, pricing });
  try {
    expect((await app.inject({ method: "POST", url: "/missions/demo/approve" })).statusCode).toBe(202);
    expect(startMission).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ budgetCents: 1160 }));
    await vi.waitFor(() => expect(log.events.at(-1)).toMatchObject({ type: "mission.finished", payload: { paused: true } }));
    expect((await app.inject("/missions")).json()).toMatchObject({ missions: [{ id: "demo", status: "paused" }] });
    expect((await app.inject("/missions/demo")).json()).toMatchObject({ id: "demo", status: "paused" });
  } finally {
    await app.close();
  }
});

it.each([
  { tier: "unpriced", configured: true, status: 422, error: "Plan cannot be priced" },
  { tier: "station", configured: false, status: 503, error: "Mission pricing not configured" },
])("fails closed when a budgeted plan cannot be priced ($status)", async ({ tier, configured, status, error }) => {
  const log = await missionWithBudget(500, tier);
  const startMission = vi.fn(async () => {});
  const app = buildServer(log, { startMission, pricing: configured ? pricing : undefined });
  try {
    const res = await app.inject({ method: "POST", url: "/missions/demo/approve" });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
    expect(startMission).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it.each([
  { label: "applies defaults at approval", savedBudget: 500, defaulted: true,
    payload: undefined, budgetCents: 1200, unitAllowanceCents: 40 },
  { label: "keeps an explicit creation budget", savedBudget: 1160, defaulted: false,
    payload: {}, budgetCents: 1160, unitAllowanceCents: 40 },
  { label: "applies explicit approval overrides", savedBudget: 500, defaulted: false,
    payload: { budget_cents: 1300, unit_allowance_cents: 0 }, budgetCents: 1300, unitAllowanceCents: 0 },
])("$label and saves the effective limits", async ({ savedBudget, defaulted, payload, budgetCents, unitAllowanceCents }) => {
  const log = await missionWithBudget(savedBudget);
  if (defaulted) log.events[0]!.payload.budget_defaulted = true;
  const startMission = vi.fn<MissionStarter>(async () => {});
  const app = buildServer(log, {
    startMission, pricing,
    readBudgetDefaults: async () => ({ budgetCents: 1200, unitAllowanceCents: 40 }),
  });
  try {
    const approval = await app.inject({ method: "POST", url: "/missions/demo/approve", payload });
    expect(approval.statusCode).toBe(202);
    expect(startMission).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ budgetCents, unitAllowanceCents }));
    expect(log.events.at(-1)).toMatchObject({ type: "plan.approved", payload: {
      budget_cents: budgetCents, unit_allowance_cents: unitAllowanceCents,
    } });
    expect((await app.inject("/missions/demo/treasury")).json()).toMatchObject({ budget_cents: budgetCents });
  } finally {
    await app.close();
  }
});
