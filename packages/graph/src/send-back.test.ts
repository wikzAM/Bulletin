import { describe, expect, it } from "vitest";
import type { PassVerdict } from "@bulletin/core";
import { appendLesson, formatSendBack, lessonLine, promoteLessons } from "./send-back";

const red = (reason: string, evidence: string): PassVerdict => ({ verdict: "red", reason, evidence });

describe("formatSendBack", () => {
  it("matches the spec example byte for byte", () => {
    const out = formatSendBack({
      unitId: "u4",
      attempt: 1,
      maxAttempts: 3,
      verdict: red(
        "tests failed",
        "test_login_rate_limit: expected 429, got 200\napps/api/src/ratelimit.ts:41",
      ),
      files: ["apps/api/src/ratelimit.ts", "apps/api/test/ratelimit.test.ts"],
    });
    expect(out).toBe(
      [
        "UNIT      u4",
        "VERDICT   RED (attempt 1 of 3)",
        "REASON    tests failed",
        "EVIDENCE  test_login_rate_limit: expected 429, got 200",
        "          apps/api/src/ratelimit.ts:41",
        "SCOPE     fix this unit only. Touch only: apps/api/src/ratelimit.ts, apps/api/test/ratelimit.test.ts",
      ].join("\n"),
    );
  });

  it("handles single-line evidence", () => {
    const out = formatSendBack({ unitId: "a", attempt: 1, maxAttempts: 3, verdict: red("r", "one"), files: ["x.ts"] });
    expect(out.split("\n")).toHaveLength(5);
    expect(out).toContain("EVIDENCE  one\n");
    expect(out.endsWith("\n")).toBe(false);
  });

  it("prints - for empty or whitespace evidence", () => {
    for (const ev of ["", "  \n "]) {
      const out = formatSendBack({ unitId: "a", attempt: 1, maxAttempts: 3, verdict: red("r", ev), files: ["x"] });
      expect(out).toContain("EVIDENCE  -\n");
    }
  });

  it("normalizes CRLF evidence", () => {
    const out = formatSendBack({ unitId: "a", attempt: 1, maxAttempts: 3, verdict: red("r", "l1\r\nl2"), files: ["x"] });
    expect(out).not.toContain("\r");
    expect(out).toContain("EVIDENCE  l1\n          l2\n");
  });

  it("reports attempt numbers in VERDICT", () => {
    const out = formatSendBack({ unitId: "a", attempt: 2, maxAttempts: 5, verdict: red("r", "e"), files: ["x"] });
    expect(out).toContain("VERDICT   RED (attempt 2 of 5)");
  });
});

describe("lessonLine", () => {
  it("formats the line", () => {
    expect(lessonLine("u1", "Title", "tests failed")).toBe("- tests failed (u1: Title)");
  });
  it("collapses newlines in reason and title", () => {
    expect(lessonLine("u1", "A\r\nB", "x\ny\n\nz")).toBe("- x y z (u1: A B)");
  });
});

describe("appendLesson", () => {
  it("handles empty input", () => {
    expect(appendLesson("", "- a (u: t)")).toBe("- a (u: t)\n");
  });
  it("adds a newline when missing", () => {
    expect(appendLesson("- x (u: t)", "- a (u: t)")).toBe("- x (u: t)\n- a (u: t)\n");
  });
  it("does not double the newline when present", () => {
    expect(appendLesson("- x (u: t)\n", "- a (u: t)")).toBe("- x (u: t)\n- a (u: t)\n");
  });
  it("strips trailing newlines from the line", () => {
    expect(appendLesson("", "- a (u: t)\n")).toBe("- a (u: t)\n");
  });
});

describe("promoteLessons", () => {
  const L = (r: string, u = "u1", t = "T") => `- ${r} (${u}: ${t})\n`;

  it("leaves a reason seen once unchanged, byte-identical", () => {
    expect(promoteLessons(L("a"), "rules")).toBe("rules");
    expect(promoteLessons(L("a"), "")).toBe("");
  });
  it("promotes a reason seen twice once", () => {
    expect(promoteLessons(L("a") + L("a", "u2"), "")).toBe("- Cut units so this cannot recur: a\n");
  });
  it("promotes a reason seen three times as one line", () => {
    expect(promoteLessons(L("a") + L("a", "u2") + L("a", "u3"), "")).toBe("- Cut units so this cannot recur: a\n");
  });
  it("does not re-add a reason already in rules", () => {
    const rules = "- Cut units so this cannot recur: a\n";
    expect(promoteLessons(L("a") + L("a", "u2"), rules)).toBe(rules);
  });
  it("promotes different reasons in first-appearance order", () => {
    const lessons = L("b") + L("a") + L("a", "u2") + L("b", "u2");
    expect(promoteLessons(lessons, "")).toBe(
      "- Cut units so this cannot recur: b\n- Cut units so this cannot recur: a\n",
    );
  });
  it("handles a reason containing parentheses", () => {
    const lessons = L("fails (twice)") + L("fails (twice)", "u2");
    expect(promoteLessons(lessons, "")).toBe("- Cut units so this cannot recur: fails (twice)\n");
  });
  it("handles a title containing parentheses", () => {
    const lessons = L("a", "u1", "Do (thing)") + L("a", "u2", "Other (x)");
    expect(promoteLessons(lessons, "")).toBe("- Cut units so this cannot recur: a\n");
  });
  it("appends after rules without a trailing newline", () => {
    expect(promoteLessons(L("a") + L("a", "u2"), "- old")).toBe("- old\n- Cut units so this cannot recur: a\n");
  });
});
