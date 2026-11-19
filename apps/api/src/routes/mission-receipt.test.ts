import { MemoryEventLog } from "@bulletin/core";
import { expect, it } from "vitest";
import { buildServer } from "../server";

it("exports the finished receipt with fixed hold reasons and non-sensitive metrics", async () => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  const secret = "sk-ant-fixture-never-export";
  const privatePath = "D:/private/.env";
  const fileContents = "PRIVATE_FILE_CONTENTS_IN_THE_EVENT";
  await log.emit({ mission_id, type: "mission.created", payload: { repo: privatePath, goal: secret } });
  await log.emit({ mission_id, type: "briefing.versioned", payload: { markdown: fileContents } });
  await log.emit({ mission_id, unit_id: "seed", type: "unit.sent_back", payload: { reason: secret, repeat_return: true } });
  await log.emit({ mission_id, unit_id: "seed", type: "unit.merged", payload: { evidence: fileContents } });
  await log.emit({ mission_id, unit_id: privatePath, type: "unit.merged" });
  await log.emit({ mission_id, unit_id: secret, type: "unit.merged" });
  await log.emit({ mission_id, unit_id: "review", type: "unit.held", payload: { lane: "closed", reason: secret } });
  await log.emit({ mission_id, unit_id: "review", type: "decision.opened", payload: { kind: "closed_lane_merge", evidence: fileContents } });
  await log.emit({ mission_id, unit_id: "audit", type: "unit.held" });
  await log.emit({ mission_id, unit_id: "audit", type: "decision.opened", payload: { kind: "gated_retry", reason: secret } });
  await log.emit({ mission_id, type: "decision.resolved", payload: { kind: "question", answer: secret } });
  await log.emit({ mission_id, type: "ledger.charged", payload: { cost_cents: 1.25, command_output: fileContents } });
  await log.emit({ mission_id: "other", unit_id: "other-task", type: "unit.merged" });
  await log.emit({ mission_id, type: "mission.finished" });
  await log.emit({ mission_id, type: "ledger.charged", payload: { cost_cents: 99 } });

  const app = buildServer(log);
  try {
    const response = await app.inject("/missions/demo/receipt.md");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="receipt.md"');
    expect(response.payload).toContain("## Shipped\n- `seed`\n- Task 2\n- Task 3");
    expect(response.payload).toContain("- `review` — Closed-lane work requires approval.");
    expect(response.payload).toContain("- `audit` — A retry requires approval.");
    expect(response.payload).toContain("- 1.25 cents spent");
    expect(response.payload).toContain("- 1 human touch");
    expect(response.payload).toContain("- 1 repeat return");
    for (const text of [secret, privatePath, fileContents, "other-task", "100.25 cents"]) {
      expect(response.payload).not.toContain(text);
    }
  } finally {
    await app.close();
  }
});

it("reports missing and unfinished receipts and treats interruption as unfinished", async () => {
  const log = new MemoryEventLog();
  await log.emit({ mission_id: "waiting", type: "mission.created" });
  await log.emit({ mission_id: "interrupted", type: "mission.created" });
  await log.emit({ mission_id: "interrupted", type: "mission.interrupted" });
  await log.emit({ mission_id: "legacy", type: "mission.created" });
  await log.emit({ mission_id: "legacy", type: "mission.finished", payload: { interrupted: true } });
  await log.emit({ mission_id: "resumed", type: "mission.created" });
  await log.emit({ mission_id: "resumed", type: "mission.finished", payload: { interrupted: true } });
  await log.emit({ mission_id: "resumed", type: "mission.resumed" });

  const app = buildServer(log);
  try {
    const missing = await app.inject("/missions/missing/receipt.md");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Mission not found" });
    for (const id of ["waiting", "interrupted", "legacy", "resumed"]) {
      const response = await app.inject(`/missions/${id}/receipt.md`);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "Mission has not finished" });
    }
  } finally {
    await app.close();
  }
});
