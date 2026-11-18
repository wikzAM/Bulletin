import { describe, expect, it } from "vitest";
import { answerPayload, groupInbox, resolvePayload, type InboxItem } from "../src/lib/inbox";

const items: InboxItem[] = [
  { id: "q1", kind: "question", title: "What seed?", detail: "Need a seed", unitId: "store" },
  { id: "h1", kind: "closed_lane_merge", title: "Migration", detail: "Needs OK", unitId: "mig", branch: "u/mig" },
  { id: "h2", kind: "gated_retry", title: "List", detail: "Passed after retry", unitId: "list", branch: "u/list" },
  { id: "b1", kind: "budget", title: "Spending limit", detail: "Paused", unitId: null },
  { id: "q2", kind: "question", title: "Timezone?", detail: "UTC?", unitId: "list" },
];

describe("groupInbox", () => {
  it("groups by kind in a stable order: questions, closed-lane, retry, budget", () => {
    const groups = groupInbox(items);
    expect(groups.map((g) => g.kind)).toEqual(["question", "closed_lane_merge", "gated_retry", "budget"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["q1", "q2"]);
    expect(groups[1]!.items[0]!.id).toBe("h1");
  });

  it("omits empty groups", () => {
    expect(groupInbox(items.filter((i) => i.kind === "budget")).map((g) => g.kind)).toEqual(["budget"]);
  });
});

describe("inbox payloads", () => {
  it("posts choice and answer bodies the API expects", () => {
    expect(resolvePayload("approve")).toEqual({ choice: "approve" });
    expect(resolvePayload("reject")).toEqual({ choice: "reject" });
    expect(answerPayload("Use seed 31.")).toEqual({ answer: "Use seed 31." });
  });
});
