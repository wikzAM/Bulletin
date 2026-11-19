/** Plain words shown when a report number is missing (docs/API.md GET /missions/:id/report). */
export const NOT_AVAILABLE_YET = "not available yet";

export interface MissionReport {
  mission_id: string;
  shipped: string[];
  held: string[];
  failed: string[];
  blocked: string[];
  touches: number;
  cost_cents: number;
  elapsed_ms: number | null;
  touch_rate: number | null;
  auto_answer_rate: number | null;
  cost_per_green_unit_cents: number | null;
}

export type ReportOutcome = { kind: "ready"; report: MissionReport } | { kind: "not_available" };

export interface ReportLine {
  label: string;
  value: string;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Turns a transport response into a report, or "not available" when the project has not finished. */
export function interpretReport(status: number, body: unknown): ReportOutcome {
  if (status !== 200 || body === null || typeof body !== "object") return { kind: "not_available" };
  const raw = body as Record<string, unknown>;
  const cost = finite(raw.cost_cents);
  const touches = finite(raw.touches);
  if (typeof raw.mission_id !== "string" || cost === null || touches === null) return { kind: "not_available" };
  return {
    kind: "ready",
    report: {
      mission_id: raw.mission_id,
      shipped: names(raw.shipped),
      held: names(raw.held),
      failed: names(raw.failed),
      blocked: names(raw.blocked),
      touches,
      cost_cents: cost,
      elapsed_ms: finite(raw.elapsed_ms),
      touch_rate: finite(raw.touch_rate),
      auto_answer_rate: finite(raw.auto_answer_rate),
      cost_per_green_unit_cents: finite(raw.cost_per_green_unit_cents),
    },
  };
}

function list(ids: string[]): string {
  return ids.length === 0 ? "None" : ids.join(", ");
}

function elapsed(ms: number | null): string {
  if (ms === null) return NOT_AVAILABLE_YET;
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} seconds`;
  return `${minutes} min ${seconds} sec`;
}

/** One line per number the report page shows. Null metrics read as not available yet. */
export function reportLines(
  report: MissionReport,
  formatCents: (cents: number) => string,
  formatPercent: (ratio: number) => string,
): ReportLine[] {
  const rate = (value: number | null) => (value === null ? NOT_AVAILABLE_YET : formatPercent(value));
  const money = (value: number | null) => (value === null ? NOT_AVAILABLE_YET : formatCents(value));
  return [
    { label: "Shipped", value: list(report.shipped) },
    { label: "Waiting for approval", value: list(report.held) },
    { label: "Failed", value: list(report.failed) },
    { label: "Blocked", value: list(report.blocked) },
    { label: "Your touches", value: String(report.touches) },
    { label: "Spent", value: formatCents(report.cost_cents) },
    { label: "Time taken", value: elapsed(report.elapsed_ms) },
    { label: "How often you stepped in", value: rate(report.touch_rate) },
    { label: "Answered without you", value: rate(report.auto_answer_rate) },
    { label: "Cost per finished task", value: money(report.cost_per_green_unit_cents) },
  ];
}
