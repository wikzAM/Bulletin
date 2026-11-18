import { copy } from "./copy";

export type InboxKind = "question" | "closed_lane_merge" | "gated_retry" | "budget";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  detail: string;
  unitId: string | null;
  branch?: string;
}

export interface InboxGroup {
  kind: InboxKind;
  label: string;
  items: InboxItem[];
}

const ORDER: InboxKind[] = ["question", "closed_lane_merge", "gated_retry", "budget"];

export function groupInbox(items: InboxItem[]): InboxGroup[] {
  const labels = copy.inbox.groups;
  return ORDER.map((kind) => ({
    kind,
    label: labels[kind],
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);
}

/** Body for POST .../decisions/:unit/resolve */
export function resolvePayload(choice: "approve" | "reject"): { choice: "approve" | "reject" } {
  return { choice };
}

/** Body for POST /questions/:id/answer */
export function answerPayload(answer: string): { answer: string } {
  return { answer };
}

