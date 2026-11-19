import type { BulletinEvent } from "@bulletin/core";

interface Receipt {
  shipped: readonly string[];
  held: readonly string[];
  cost_cents: number;
  touches: number;
  repeat_returns: number;
}

const closedHold = "Closed-lane work requires approval.";
const retryHold = "A retry requires approval.";
const approvalPending = "Approval pending.";
const plainId = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
const credentialPrefix = /^(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|akia|asia|aiza)/i;

function taskName(id: string, index: number): string {
  return plainId.test(id) && !credentialPrefix.test(id) ? `\`${id}\`` : `Task ${index + 1}`;
}

export function renderMissionReceipt(receipt: Receipt, history: readonly BulletinEvent[]): string {
  const reasons = new Map<string, string>();
  for (const { type, unit_id, payload } of history) {
    if (unit_id === null) continue;
    if (type === "unit.held") {
      reasons.set(unit_id, payload.lane === "closed" ? closedHold : payload.lane === "gated" ? retryHold : approvalPending);
    } else if (type === "decision.opened") {
      if (payload.kind === "closed_lane_merge") reasons.set(unit_id, closedHold);
      if (payload.kind === "gated_retry") reasons.set(unit_id, retryHold);
    }
  }

  const shipped = receipt.shipped.map((id, index) => `- ${taskName(id, index)}`);
  const held = receipt.held.map((id, index) => `- ${taskName(id, index)} — ${reasons.get(id) ?? approvalPending}`);
  return [
    "# Mission receipt", "",
    "## Shipped", ...(shipped.length ? shipped : ["- None"]), "",
    "## Held", ...(held.length ? held : ["- None"]), "",
    "## Totals",
    `- ${receipt.cost_cents} ${receipt.cost_cents === 1 ? "cent" : "cents"} spent`,
    `- ${receipt.touches} human ${receipt.touches === 1 ? "touch" : "touches"}`,
    `- ${receipt.repeat_returns} repeat ${receipt.repeat_returns === 1 ? "return" : "returns"}`,
    "",
  ].join("\n");
}
