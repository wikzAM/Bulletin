import { copy, LANE_LABELS } from "./copy";
import { formatCents, formatPercent } from "./format";
import { WARNING_RATIO } from "./treasury";
import type { SettingsInfo } from "./types";

export interface SettingsView {
  jobs: { key: string; job: string; model: string; note: string | null }[];
  tiers: { key: string; label: string; model: string }[];
  limits: { label: string; value: string }[];
  lanes: { key: "closed" | "gated"; label: string; patterns: string[] }[];
}

function humanize(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Plain labels for the settings page; jobs and tiers the copy does not know are shown by name. */
export function settingsView(info: SettingsInfo): SettingsView {
  const t = copy.settings;
  const jobs = info.roles.map((r) => ({
    key: r.role,
    job: t.jobs[r.role] ?? humanize(r.role),
    model: r.model,
    note: r.fallback ? t.fallback(r.fallback) : r.escalate ? t.escalate(r.escalate) : null,
  }));
  const tiers = info.tiers.map((x) => ({ key: x.tier, label: t.tiers[x.tier] ?? humanize(x.tier), model: x.model }));
  const limits: SettingsView["limits"] = [];
  if (info.defaultBudgetCents !== null) {
    limits.push({ label: t.budget, value: formatCents(info.defaultBudgetCents) });
    limits.push({ label: t.warning, value: t.warningValue(formatPercent(WARNING_RATIO)) });
  }
  if (info.unitAllowanceCents !== null) limits.push({ label: t.allowance, value: formatCents(info.unitAllowanceCents) });
  const lanes = info.lanes
    ? (["closed", "gated"] as const).map((key) => ({ key, label: LANE_LABELS[key], patterns: info.lanes?.[key] ?? [] }))
    : [];
  return { jobs, tiers, limits, lanes };
}
