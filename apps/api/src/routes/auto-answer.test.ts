import { MemoryEventLog } from "@bulletin/core";
import { ANSWERER_PROMPT } from "@bulletin/prompts";
import { expect, it, vi } from "vitest";
import { buildServer } from "../server";

const markdown = "# Briefing: Demo\n## Constraints\nUse seed 17 for the demo.";

it.each([
  { reply: '{"answer":"Use seed 17.","briefing_ref":"Constraints"}', status: "answered" },
  { reply: '{"answer":"SILENT"}', status: "open" },
  { reply: "SILENT", status: "open" },
  { reply: '{"answer":"Use seed 31.","briefing_ref":"Imaginary section"}', status: "open" },
  { reply: '{"answer":"Use seed 31."}', status: "open" },
])("uses the Briefing and the Answerer prompt for a $status result", async ({ reply, status }) => {
  const events = new MemoryEventLog();
  const mission_id = "demo";
  await events.emit({ mission_id, type: "mission.created" });
  await events.emit({ mission_id, type: "briefing.versioned", payload: { version: 1, markdown } });
  const answererCall = vi.fn(async () => reply);
  const app = buildServer(events, { answererCall });

  try {
    const created = await app.inject({ method: "POST", url: "/questions", payload: { mission_id, body: "Which seed should I use?" } });
    expect(created.statusCode).toBe(201);
    const question = created.json();
    const res = await app.inject({ method: "POST", url: `/questions/${question.id}/auto-answer` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: question.id, status });
    expect(answererCall).toHaveBeenCalledExactlyOnceWith(ANSWERER_PROMPT.system, expect.stringContaining(markdown));
    expect(answererCall).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("Which seed should I use?"));
    expect((await app.inject("/questions")).json()).toEqual({ questions: [res.json()] });

    if (status === "answered") {
      expect(res.json()).toMatchObject({ answer: "Use seed 17.", source: "briefing", briefing_ref: "Constraints" });
      expect(events.events.slice(4)).toMatchObject([
        { type: "dispatch.answered", payload: { question_id: question.id, source: "briefing", briefing_ref: "Constraints" } },
        { type: "decision.resolved", payload: { question_id: question.id, source: "briefing" } },
      ]);
    } else {
      expect(res.json()).toMatchObject({ answer: null, auto_answer_tried: true });
      expect(events.events.slice(4)).toMatchObject([
        { type: "dispatch.escalated", payload: { question_id: question.id, outcome: "silent", prompt_version: ANSWERER_PROMPT.version } },
      ]);
    }
  } finally {
    await app.close();
  }
});

it("rejects auto-answer before calling a model when the mission has no completed Briefing", async () => {
  const events = new MemoryEventLog();
  await events.emit({ mission_id: "demo", type: "mission.created" });
  const answererCall = vi.fn(async () => "SILENT");
  const app = buildServer(events, { answererCall });
  try {
    const created = await app.inject({ method: "POST", url: "/questions", payload: { mission_id: "demo", body: "Which seed?" } });
    const res = await app.inject({ method: "POST", url: `/questions/${created.json().id}/auto-answer` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "Mission has no completed Briefing" });
    expect(answererCall).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
