import { describe, expect, it } from "vitest";
import { judge, tailLines } from "./judge";
import type { CommandKind, CommandResult, JudgeInput } from "./judge";

function base(over: Partial<JudgeInput> = {}): JudgeInput {
  return {
    unitFiles: ["apps/api/src/**"],
    changedFiles: ["apps/api/src/a.ts"],
    lockedPaths: [".github/**", ".bulletin/**"],
    diffLines: 10,
    commands: [],
    ...over,
  };
}

function cmd(kind: CommandKind, exitCode: number, output = ""): CommandResult {
  return { kind, command: `run ${kind}`, exitCode, output };
}

describe("judge", () => {
  it("is red when nothing changed", () => {
    expect(judge(base({ changedFiles: [] }))).toEqual({
      verdict: "red",
      reason: "nothing changed",
      evidence: "",
    });
  });

  it("is red on a locked path with the offending paths as evidence", () => {
    const v = judge(base({ changedFiles: ["apps/api/src/a.ts", ".github/workflows/ci.yml"] }));
    expect(v).toEqual({ verdict: "red", reason: "locked path", evidence: ".github/workflows/ci.yml" });
  });

  it("reports locked path before out of scope", () => {
    const v = judge(base({ changedFiles: [".bulletin/lanes.json"], unitFiles: ["apps/api/src/**"] }));
    expect(v.reason).toBe("locked path");
  });

  it("is red out of scope with the exact offending paths", () => {
    const v = judge(base({ changedFiles: ["apps/api/src/a.ts", "README.md", "docs/x.md"] }));
    expect(v).toEqual({ verdict: "red", reason: "out of scope", evidence: "README.md\ndocs/x.md" });
  });

  it("passes a diff exactly at the limit", () => {
    expect(judge(base({ diffLines: 400 })).verdict).toBe("green");
  });

  it("is red one line over the limit with exact evidence", () => {
    expect(judge(base({ diffLines: 401 }))).toEqual({
      verdict: "red",
      reason: "diff too large",
      evidence: "401 changed lines, limit 400",
    });
  });

  it("honours a custom maxDiffLines", () => {
    expect(judge(base({ diffLines: 51, maxDiffLines: 50 }))).toEqual({
      verdict: "red",
      reason: "diff too large",
      evidence: "51 changed lines, limit 50",
    });
    expect(judge(base({ diffLines: 50, maxDiffLines: 50 })).verdict).toBe("green");
  });

  it.each([
    ["test", "tests failed"],
    ["acceptance", "acceptance failed"],
    ["typecheck", "typecheck failed"],
    ["lint", "lint failed"],
  ] as const)("maps a failing %s command to %s", (kind, reason) => {
    const v = judge(base({ commands: [cmd(kind, 1, "boom")] }));
    expect(v).toEqual({ verdict: "red", reason, evidence: "boom" });
  });

  it("lets the first failing command decide", () => {
    const v = judge(
      base({ commands: [cmd("test", 0), cmd("lint", 2, "lint out"), cmd("test", 1, "test out")] }),
    );
    expect(v).toEqual({ verdict: "red", reason: "lint failed", evidence: "lint out" });
  });

  it("trims evidence to the last 30 lines of a 50-line output", () => {
    const output = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const v = judge(base({ commands: [cmd("test", 1, output)] }));
    const lines = v.evidence.split("\n");
    expect(lines).toHaveLength(30);
    expect(lines[0]).toBe("line 21");
    expect(lines[29]).toBe("line 50");
  });

  it("is green when every check passes", () => {
    expect(judge(base({ commands: [cmd("test", 0), cmd("typecheck", 0)] }))).toEqual({
      verdict: "green",
      reason: "all checks passed",
      evidence: "",
    });
  });

  it("is green with an empty commands list when rules 0-3 pass", () => {
    expect(judge(base()).verdict).toBe("green");
  });
});

describe("tailLines", () => {
  const numbered = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n");

  it("defaults to the last 30 lines", () => {
    const out = tailLines(numbered(40)).split("\n");
    expect(out).toHaveLength(30);
    expect(out[0]).toBe("l11");
  });

  it("returns all lines when there are fewer than n", () => {
    expect(tailLines(numbered(3))).toBe("l1\nl2\nl3");
  });

  it("honours a custom n", () => {
    expect(tailLines(numbered(10), 2)).toBe("l9\nl10");
  });

  it("drops trailing blank lines before taking the tail", () => {
    expect(tailLines("a\nb\nc\n\n  \n", 2)).toBe("b\nc");
  });

  it("handles CRLF input", () => {
    expect(tailLines("a\r\nb\r\nc\r\n", 2)).toBe("b\nc");
  });

  it("returns an empty string for empty input", () => {
    expect(tailLines("")).toBe("");
    expect(tailLines("\n\n")).toBe("");
  });
});
