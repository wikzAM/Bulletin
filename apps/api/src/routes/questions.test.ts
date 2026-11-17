import { MemoryEventLog } from "@bulletin/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server";

describe("question board", () => {
  let events: MemoryEventLog;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    events = new MemoryEventLog();
    await events.emit({ mission_id: "demo", type: "mission.created" });
    await events.emit({ mission_id: "other", type: "mission.created" });
    app = buildServer(events);
  });

  afterEach(async () => {
    await app.close();
  });

  function postQuestion(mission_id: string, body: string, unit_id?: string) {
    return app.inject({ method: "POST", url: "/questions", payload: { mission_id, body, unit_id } });
  }

  it("GET /questions lists an empty board and supports a per-mission filter", async () => {
    const empty = await app.inject("/questions");
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ questions: [] });

    const first = await postQuestion("demo", "First");
    const second = await postQuestion("other", "Second");
    const third = await postQuestion("demo", "Third");
    const all = await app.inject("/questions");
    const filtered = await app.inject("/questions?mission_id=demo");
    expect(all.json()).toEqual({ questions: [first.json(), second.json(), third.json()] });
    expect(filtered.json()).toEqual({ questions: [first.json(), third.json()] });
  });

  it("POST /questions records the question and publishes the dispatch and decision", async () => {
    const res = await postQuestion("demo", "  Which seed should I use?  ", "seed-data");
    expect(res.statusCode).toBe(201);
    const question = res.json();
    expect(question).toEqual({
      id: expect.any(String),
      mission_id: "demo",
      unit_id: "seed-data",
      body: "Which seed should I use?",
      status: "open",
      created_at: expect.any(String),
      answer: null,
      answered_at: null,
    });
    expect(events.events.slice(2).map(({ type, mission_id, unit_id, payload }) => ({ type, mission_id, unit_id, payload })))
      .toEqual([
        {
          type: "dispatch.asked", mission_id: "demo", unit_id: "seed-data",
          payload: { question_id: question.id, body: question.body },
        },
        {
          type: "decision.opened", mission_id: "demo", unit_id: "seed-data",
          payload: { question_id: question.id, kind: "question" },
        },
      ]);
  });

  it("POST /questions/:id/answer resolves once even when answers race", async () => {
    const created = await postQuestion("demo", "Which seed should I use?");
    const question = created.json();
    expect(question.unit_id).toBeNull();
    const url = `/questions/${question.id}/answer`;
    const responses = await Promise.all(["  Use seed 17.  ", "Use seed 31."].map((answer) =>
      app.inject({ method: "POST", url, payload: { answer } }),
    ));
    expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    const answered = responses.find((res) => res.statusCode === 200)?.json();
    expect(answered).toEqual({
      ...question,
      status: "answered",
      answer: expect.stringMatching(/^Use seed (17|31)\.$/),
      answered_at: expect.any(String),
    });
    expect(responses.find((res) => res.statusCode === 409)?.json()).toEqual({ error: "Question already answered" });
    expect((await app.inject("/questions")).json()).toEqual({ questions: [answered] });
    expect(events.events.slice(4).map(({ type, payload }) => ({ type, payload }))).toEqual([
      { type: "dispatch.answered", payload: { question_id: question.id, answer: answered.answer } },
      { type: "decision.resolved", payload: { question_id: question.id, kind: "question" } },
    ]);
  });

  it("rejects blank questions and answers and rejects missing missions and questions", async () => {
    const blank = await postQuestion("demo", "  ");
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ error: "Invalid request" });

    const missingMission = await postQuestion("missing", "Question");
    expect(missingMission.statusCode).toBe(404);
    expect(missingMission.json()).toEqual({ error: "Mission not found" });

    const url = "/questions/missing/answer";
    const blankAnswer = await app.inject({ method: "POST", url, payload: { answer: " " } });
    expect(blankAnswer.statusCode).toBe(400);
    expect(blankAnswer.json()).toEqual({ error: "Invalid request" });

    const missingQuestion = await app.inject({ method: "POST", url, payload: { answer: "Answer" } });
    expect(missingQuestion.statusCode).toBe(404);
    expect(missingQuestion.json()).toEqual({ error: "Question not found" });
    expect(events.events).toHaveLength(2);
  });
});
