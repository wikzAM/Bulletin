import { MemoryEventLog } from "@bulletin/core";
import { expect, it, vi } from "vitest";
import { buildServer } from "../server";
import { QuestionWorkflow } from "./question-workflow";
import { MemoryQuestionStore } from "./questions-store";

it("releases a station waiting for a human answer and serves the next ask without a model call", async () => {
  const log = new MemoryEventLog();
  const workflow = new QuestionWorkflow(log, new MemoryQuestionStore());
  const answerer = vi.fn(async () => "SILENT");
  const mission_id = "demo";
  await log.emit({ mission_id, type: "mission.created" });
  await log.emit({ mission_id, type: "briefing.versioned", payload: {
    briefing_id: "briefing", version: 1, markdown: "# Briefing: Demo\n\n## Decisions log\n",
  } });
  await log.emit({ mission_id, type: "plan.approved" });
  const tools = await workflow.stationTools(answerer);
  const station = tools({ missionId: mission_id, unit_id: "seed" });
  const app = buildServer(log, { questionWorkflow: workflow });
  try {
    const ask = (question: string) => station.call("bulletin_ask", { question }).then((raw) => JSON.parse(raw));
    const pending = await ask("Which seed should I use?");
    expect(pending).toMatchObject({ status: "pending", dispatch_id: expect.any(String) });
    const waiting = station.call("bulletin_wait", { dispatch_id: pending.dispatch_id, timeout_s: 10 });
    const board = await app.inject("/questions?mission_id=demo");
    expect(board.json().questions).toMatchObject([{ id: pending.dispatch_id, unit_id: "seed", status: "open" }]);
    const answered = await app.inject({
      method: "POST", url: `/questions/${pending.dispatch_id}/answer`, payload: { answer: "Seed 17" },
    });
    expect(answered.statusCode).toBe(200);
    expect(JSON.parse(await waiting)).toEqual({ status: "answered", answer: "Seed 17", source: "human", briefing_ref: "Decisions log" });
    expect(await ask(" WHICH   SEED SHOULD I USE? ")).toEqual({ status: "answered", answer: "Seed 17", source: "cache", briefing_ref: "Decisions log" });
    expect(answerer).toHaveBeenCalledTimes(1);
    expect(log.events.filter(({ type }) => type === "briefing.versioned").at(-1)?.payload.version).toBe(2);
    expect(log.events.filter(({ type }) => type === "decision.opened")).toHaveLength(1);
    expect((await app.inject("/missions/demo")).json().status).toBe("running");
  } finally {
    await app.close();
  }
}, 30_000);
