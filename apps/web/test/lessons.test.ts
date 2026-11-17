import { describe, expect, it } from "vitest";
import { appendLesson, lessonLine, promoteLessons } from "../../../packages/graph/src/send-back";
import { toRulesInfo } from "../lib/api-adapters";
import { parseLessons, parseRules } from "../lib/lessons";
import { mockMissions, mockRules } from "../lib/mock";

const LESSONS_HEADER = "# Lessons\n\nOne line per send-back.\n";
const RULES_HEADER = "# Rules\n\nRules about how to cut units, promoted from lessons.md.\n";

describe("parseLessons", () => {
  it("reads lines written by the engine, newest first", () => {
    let lessons = LESSONS_HEADER;
    lessons = appendLesson(lessons, lessonLine("store", "Due date field", "tests failed"));
    lessons = appendLesson(lessons, lessonLine("list", "Overdue list", "touched a file outside its scope"));
    expect(parseLessons(lessons)).toEqual([
      { reason: "touched a file outside its scope", taskId: "list", taskTitle: "Overdue list" },
      { reason: "tests failed", taskId: "store", taskTitle: "Due date field" },
    ]);
  });

  it("keeps hand-written bullet lines and skips headings and prose", () => {
    expect(parseLessons("# Lessons\n\nSome prose.\n- keep migrations in their own task\n")).toEqual([
      { reason: "keep migrations in their own task", taskId: null, taskTitle: null },
    ]);
  });

  it("is empty for an empty or missing file", () => {
    expect(parseLessons("")).toEqual([]);
    expect(parseLessons(LESSONS_HEADER)).toEqual([]);
  });
});

describe("parseRules", () => {
  it("reads promoted rules newest first and marks them as learned", () => {
    let lessons = LESSONS_HEADER;
    for (const reason of ["tests failed", "tests failed", "lint errors", "lint errors"]) {
      lessons = appendLesson(lessons, lessonLine("u1", "Store", reason));
    }
    const rules = promoteLessons(lessons, RULES_HEADER);
    expect(parseRules(rules)).toEqual([
      { text: "lint errors", learned: true },
      { text: "tests failed", learned: true },
    ]);
  });

  it("keeps rules a person wrote", () => {
    expect(parseRules(`${RULES_HEADER}- Never mix schema and UI changes in one task\n`)).toEqual([
      { text: "Never mix schema and UI changes in one task", learned: false },
    ]);
  });
});

describe("toRulesInfo", () => {
  it("reads both files, treating a missing one as empty", () => {
    expect(toRulesInfo({ mission_id: "m1", rules: "# Rules\n", lessons: null })).toEqual({ rules: "# Rules\n", lessons: "" });
    expect(toRulesInfo({ rules_md: "- a\n", lessons_md: "- b (u: T)\n" })).toEqual({ rules: "- a\n", lessons: "- b (u: T)\n" });
  });

  it("is null for a body without either file", () => {
    expect(toRulesInfo({ error: "Mission not found" })).toBeNull();
    expect(toRulesInfo(null)).toBeNull();
  });
});

describe("mock rules", () => {
  it("has rules and lessons for a mock project, and none for an unknown one", () => {
    const id = mockMissions[0]?.id ?? "";
    const info = mockRules(id);
    expect(info && parseLessons(info.lessons).length).toBeGreaterThan(0);
    expect(info && parseRules(info.rules).length).toBeGreaterThan(0);
    expect(mockRules("missing")).toBeNull();
  });
});
