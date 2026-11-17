import { describe, expect, it } from "vitest";
import {
  ANSWER_MAX_LENGTH,
  countQuestions,
  filterQuestions,
  parseFilter,
  questionChip,
  replaceQuestion,
  sortQuestions,
  validateAnswer,
} from "../lib/questions";
import type { Question } from "../lib/types";

function q(id: string, over: Partial<Question> = {}): Question {
  return {
    id,
    mission_id: "m1",
    unit_id: "u1",
    body: `question ${id}`,
    status: "open",
    answer: null,
    source: null,
    briefing_ref: null,
    created_at: "2026-11-16T14:00:00.000Z",
    answered_at: null,
    ...over,
  };
}

const answered = (id: string, source: Question["source"], created_at = "2026-11-16T14:00:00.000Z") =>
  q(id, { status: "answered", answer: "yes", source, answered_at: created_at, created_at });

describe("questionChip", () => {
  it("labels open questions as waiting for a person", () => {
    expect(questionChip(q("a"))).toMatchObject({ tone: "open", label: "Needs an answer" });
  });

  it("says where an answer came from", () => {
    expect(questionChip(answered("a", "human")).label).toBe("Answered by a person");
    expect(questionChip(answered("a", "briefing")).label).toBe("Answered from the requirements");
    expect(questionChip(answered("a", "cache")).label).toBe("Answered from an earlier answer");
    expect(questionChip(answered("a", null)).label).toBe("Answered");
  });

  it("gives every chip an icon so color is not the only signal", () => {
    for (const question of [q("a"), answered("b", "human"), answered("c", "briefing"), answered("d", "cache")]) {
      expect(questionChip(question).icon.length).toBeGreaterThan(0);
    }
  });
});

describe("sortQuestions", () => {
  it("puts open questions first, then newest first within each group, without mutating", () => {
    const list = [
      answered("old-answered", "human", "2026-11-16T10:00:00.000Z"),
      q("old-open", { created_at: "2026-11-16T11:00:00.000Z" }),
      answered("new-answered", "cache", "2026-11-16T13:00:00.000Z"),
      q("new-open", { created_at: "2026-11-16T12:00:00.000Z" }),
    ];
    const copyOfList = [...list];
    expect(sortQuestions(list).map((x) => x.id)).toEqual(["new-open", "old-open", "new-answered", "old-answered"]);
    expect(list).toEqual(copyOfList);
  });
});

describe("filters and counts", () => {
  const list = [q("a"), answered("b", "human"), q("c")];

  it("counts all, open and answered", () => {
    expect(countQuestions(list)).toEqual({ all: 3, open: 2, answered: 1 });
  });

  it("filters by status", () => {
    expect(filterQuestions(list, "open").map((x) => x.id)).toEqual(["a", "c"]);
    expect(filterQuestions(list, "answered").map((x) => x.id)).toEqual(["b"]);
    expect(filterQuestions(list, "all")).toHaveLength(3);
  });

  it("reads the filter from a query value, defaulting to open", () => {
    expect(parseFilter("answered")).toBe("answered");
    expect(parseFilter("all")).toBe("all");
    expect(parseFilter(undefined)).toBe("open");
    expect(parseFilter("nonsense")).toBe("open");
    expect(parseFilter(["answered", "all"])).toBe("answered");
  });
});

describe("validateAnswer", () => {
  it("trims and accepts a real answer", () => {
    expect(validateAnswer("  Use UTC dates.  ")).toEqual({ ok: true, value: "Use UTC dates." });
  });

  it("rejects an empty or whitespace answer", () => {
    expect(validateAnswer("   ")).toEqual({ ok: false, error: "Write an answer first." });
  });

  it("rejects an answer over the length limit", () => {
    const result = validateAnswer("x".repeat(ANSWER_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(validateAnswer("x".repeat(ANSWER_MAX_LENGTH)).ok).toBe(true);
  });
});

describe("replaceQuestion", () => {
  it("swaps in the updated question by id and leaves the rest", () => {
    const list = [q("a"), q("b")];
    const next = replaceQuestion(list, answered("b", "human"));
    expect(next.map((x) => x.status)).toEqual(["open", "answered"]);
    expect(next[0]).toBe(list[0]);
    expect(list[1]?.status).toBe("open");
  });

  it("ignores an update for a question it does not have", () => {
    const list = [q("a")];
    expect(replaceQuestion(list, q("zzz"))).toEqual(list);
  });
});
