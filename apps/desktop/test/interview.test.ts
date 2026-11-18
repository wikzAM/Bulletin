import { describe, expect, it } from "vitest";
import {
  BRIEFING_MAX_LENGTH,
  MAX_QUESTIONS,
  answersPayload,
  pendingAnswer,
  planRequest,
  briefingFromGoal,
  briefingGoal,
  currentQuestion,
  initialFlow,
  flowReducer,
  progress,
  validateBriefing,
  type FlowState,
} from "../src/lib/interview";
import { mockAnswerBriefing, mockCreateMission, mockStartBriefing } from "../src/lib/mock";
import type { CreateMissionResponse } from "../src/lib/types";

const qs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, text: `Question ${i + 1}?` }));

function interviewing(n = 3): FlowState {
  let s = flowReducer(initialFlow, { type: "start", goal: "Add due dates", repo: "examples/todo-app" });
  s = flowReducer(s, { type: "questions", briefingId: "b1", questions: qs(n) });
  return s;
}

describe("flowReducer", () => {
  it("starts on the goal step", () => {
    expect(initialFlow).toMatchObject({ step: "goal", busy: false, error: null, questions: [], briefing: "" });
  });

  it("moves to questions once the interviewer replies", () => {
    let s = flowReducer(initialFlow, { type: "start", goal: "Add due dates", repo: "examples/todo-app" });
    expect(s).toMatchObject({ step: "goal", busy: true, goal: "Add due dates", repo: "examples/todo-app" });
    s = flowReducer(s, { type: "questions", briefingId: "b1", questions: qs(2) });
    expect(s).toMatchObject({ step: "interview", busy: false, briefingId: "b1", index: 0 });
    expect(currentQuestion(s)?.id).toBe("q1");
  });

  it("asks at most ten questions", () => {
    const s = interviewing(14);
    expect(s.questions).toHaveLength(MAX_QUESTIONS);
    expect(progress(s)).toEqual({ n: 1, total: 10 });
  });

  it("records answers and skips, one question at a time, and can go back", () => {
    let s = interviewing(3);
    s = flowReducer(s, { type: "answer", text: "  Dates only  " });
    expect(currentQuestion(s)?.id).toBe("q2");
    s = flowReducer(s, { type: "skip" });
    expect(progress(s)).toEqual({ n: 3, total: 3 });
    s = flowReducer(s, { type: "back" });
    expect(currentQuestion(s)?.id).toBe("q2");
    s = flowReducer(s, { type: "answer", text: "Everyone" });
    s = flowReducer(s, { type: "skip" });
    expect(s.index).toBe(3);
    expect(currentQuestion(s)).toBeNull();
    expect(answersPayload(s)).toEqual([
      { question_id: "q1", answer: "Dates only" },
      { question_id: "q2", answer: "Everyone" },
      { question_id: "q3", answer: null },
    ]);
  });

  it("treats a blank answer as a skip and does not go back past the first question", () => {
    let s = interviewing(2);
    s = flowReducer(s, { type: "back" });
    expect(s.index).toBe(0);
    s = flowReducer(s, { type: "answer", text: "   " });
    expect(answersPayload(s)[0]).toEqual({ question_id: "q1", answer: null });
  });

  it("appends follow-up questions and keeps the ten-question limit across rounds", () => {
    let s = interviewing(8);
    for (let i = 0; i < 8; i++) s = flowReducer(s, { type: "skip" });
    s = flowReducer(s, { type: "questions", briefingId: "b1", questions: [{ id: "q9", text: "?" }, { id: "q10", text: "?" }, { id: "q11", text: "?" }] });
    expect(s.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"]);
    expect(currentQuestion(s)?.id).toBe("q9");
  });

  it("goes to review with the Briefing, which can be edited", () => {
    let s = flowReducer(interviewing(1), { type: "briefing", markdown: "# Briefing: Due dates\n## Goal\nAdd due dates" });
    expect(s).toMatchObject({ step: "review", busy: false });
    s = flowReducer(s, { type: "edit", markdown: "# Briefing: Due dates\n## Goal\nAdd due dates and a filter" });
    expect(s.briefing).toContain("and a filter");
    expect(s.edited).toBe(true);
  });

  it("falls back to a Briefing made from the goal when there is no interviewer", () => {
    let s = flowReducer(initialFlow, { type: "start", goal: "Add due dates", repo: "r" });
    s = flowReducer(s, { type: "noInterviewer" });
    expect(s).toMatchObject({ step: "review", busy: false, briefing: briefingFromGoal("Add due dates"), notice: "noInterviewer" });
  });

  it("shows the plan after review", () => {
    const plan: CreateMissionResponse = { ok: false, mission_id: null, errors: ["x"], attempts: 2 };
    let s = flowReducer(interviewing(1), { type: "briefing", markdown: "b" });
    s = flowReducer(s, { type: "submit" });
    expect(s.busy).toBe(true);
    s = flowReducer(s, { type: "plan", result: plan });
    expect(s).toMatchObject({ step: "plan", busy: false, plan });
  });

  it("keeps the step and shows an error on failure, clearing it on the next action", () => {
    let s = flowReducer(initialFlow, { type: "start", goal: "g", repo: "r" });
    s = flowReducer(s, { type: "fail", message: "boom" });
    expect(s).toMatchObject({ step: "goal", busy: false, error: "boom" });
    s = flowReducer(s, { type: "start", goal: "g", repo: "r" });
    expect(s.error).toBeNull();
  });

  it("can go back from the plan to edit the Briefing, and restart from scratch", () => {
    let s = flowReducer(interviewing(1), { type: "briefing", markdown: "b" });
    s = flowReducer(s, { type: "plan", result: { ok: false, mission_id: null, errors: [], attempts: 1 } });
    s = flowReducer(s, { type: "review" });
    expect(s).toMatchObject({ step: "review", plan: null, briefing: "b" });
    expect(flowReducer(s, { type: "restart" })).toEqual(initialFlow);
  });
});

describe("briefingFromGoal", () => {
  it("fills the spec template with the goal", () => {
    const md = briefingFromGoal("Add due dates to the todo app");
    expect(md.split("\n")[0]).toBe("# Briefing: Add due dates to the todo app");
    for (const section of ["## Goal", "## Users", "## Features", "## Constraints", "## Out of scope", "## Decisions log"]) {
      expect(md).toContain(section);
    }
    expect(md).toContain("## Goal\nAdd due dates to the todo app");
  });

  it("keeps the title to one short line", () => {
    const md = briefingFromGoal(`${"word ".repeat(30)}\nsecond line`);
    expect(md.split("\n")[0]!.length).toBeLessThanOrEqual(80 + "# Briefing: ".length);
  });
});

describe("briefingGoal", () => {
  it("reads the Goal section, or falls back to the whole text", () => {
    expect(briefingGoal("# Briefing: x\n## Goal\nAdd due dates\nto items\n## Users\nme\n")).toBe("Add due dates\nto items");
    expect(briefingGoal("just a goal ")).toBe("just a goal");
    expect(mockCreateMission(briefingFromGoal("Add due dates"), "D:/r")).toMatchObject({
      ok: true,
      plan: { units: expect.arrayContaining([expect.objectContaining({ task: "Store what this needs: Add due dates" })]) },
    });
  });
});

describe("mock interviewer", () => {
  it("asks questions, then writes a Briefing with the answers in their sections", () => {
    const start = mockStartBriefing("Add due dates");
    expect(start.kind).toBe("questions");
    if (start.kind !== "questions") return;
    expect(start.questions).toHaveLength(1);
    expect(start.questions[0]?.id).toBe("1");

    const answers = ["People with long todo lists", null, null, null];
    let reply: ReturnType<typeof mockAnswerBriefing> = start;
    let asked = 1;
    for (const [i, answer] of answers.entries()) {
      if (reply.kind !== "questions") break;
      expect(reply.questions[0]?.id).toBe(String(i + 1));
      reply = mockAnswerBriefing(start.briefingId, String(i + 1), answer);
      if (reply.kind === "questions") asked += 1;
    }
    expect(asked).toBeLessThanOrEqual(MAX_QUESTIONS);
    const done = reply;
    expect(done.kind).toBe("briefing");
    if (done.kind !== "briefing") return;
    expect(done.markdown).toContain("## Goal\nAdd due dates\n## Users\nPeople with long todo lists\n## Features\n## Constraints");
    expect(validateBriefing(done.markdown).ok).toBe(true);
  });
});

describe("pendingAnswer", () => {
  const asking = flowReducer(flowReducer(initialFlow, { type: "start", goal: "Add due dates", repo: "D:/r" }), {
    type: "questions",
    briefingId: "b1",
    questions: [{ id: "1", text: "Who?" }],
  });

  it("is the question on screen with the trimmed answer, or null for a skip or a blank answer", () => {
    expect(pendingAnswer(asking, { type: "answer", text: "  Me " })).toEqual({ question: { id: "1", text: "Who?" }, answer: "Me" });
    expect(pendingAnswer(asking, { type: "answer", text: "  " })).toEqual({ question: { id: "1", text: "Who?" }, answer: null });
    expect(pendingAnswer(asking, { type: "skip" })).toEqual({ question: { id: "1", text: "Who?" }, answer: null });
  });

  it("is null for other actions or when no question is on screen", () => {
    expect(pendingAnswer(asking, { type: "back" })).toBeNull();
    expect(pendingAnswer(flowReducer(asking, { type: "skip" }), { type: "skip" })).toBeNull();
  });
});

describe("planRequest", () => {
  const reviewed = flowReducer(
    flowReducer(
      flowReducer(initialFlow, { type: "start", goal: "Add due dates", repo: "D:/r" }),
      { type: "questions", briefingId: "b1", questions: [{ id: "1", text: "Who?" }] },
    ),
    { type: "briefing", markdown: "# Briefing: Add due dates\n## Goal\nAdd due dates\n" },
  );

  it("plans from the stored Briefing when the text was not edited", () => {
    expect(planRequest(reviewed)).toEqual({ goal: "Add due dates", repo: "D:/r", briefingId: "b1" });
  });

  it("sends the edited text as the goal, without the Briefing id", () => {
    const edited = flowReducer(reviewed, { type: "edit", markdown: " # Briefing: x\n## Goal\nDue dates and reminders\n " });
    expect(planRequest(edited)).toEqual({ goal: "# Briefing: x\n## Goal\nDue dates and reminders", repo: "D:/r", briefingId: null });
  });

  it("sends the text when there was no interview", () => {
    const fallback = flowReducer(flowReducer(initialFlow, { type: "start", goal: "Add due dates", repo: "D:/r" }), { type: "noInterviewer" });
    expect(planRequest(fallback)).toMatchObject({ briefingId: null, goal: expect.stringContaining("## Goal\nAdd due dates") });
  });
});

describe("validateBriefing", () => {
  it("needs a Goal section and some text", () => {
    expect(validateBriefing("# Briefing: x\n## Goal\nDo it")).toEqual({ ok: true, value: "# Briefing: x\n## Goal\nDo it" });
    expect(validateBriefing("   ").ok).toBe(false);
    expect(validateBriefing("no sections here").ok).toBe(false);
    expect(validateBriefing(`## Goal\n${"x".repeat(BRIEFING_MAX_LENGTH)}`).ok).toBe(false);
  });
});
