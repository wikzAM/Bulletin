import { describe, expect, it } from "vitest";
import { createMockBridge } from "../src/lib/desktop-bridge";
import { repoInspectionLines, type RepoInspection } from "../src/lib/repo-inspection";

function inspection(overrides: Partial<RepoInspection> = {}): RepoInspection {
  return {
    path: "D:/repos/demo",
    exists: true,
    is_repo: true,
    root: "D:/repos/demo",
    branch: "main",
    dirty: false,
    test_command: "pnpm test",
    file_count: 12,
    file_count_capped: false,
    ...overrides,
  };
}

describe("repoInspectionLines", () => {
  it("says when the folder is not a git repository", () => {
    expect(repoInspectionLines(inspection({ is_repo: false, root: null, branch: null, dirty: null, file_count: null }))).toEqual([
      "This folder is not a git repository.",
    ]);
  });

  it("says when the repository has no commits", () => {
    expect(repoInspectionLines(inspection({ file_count: 0, branch: null }))).toEqual(["This repository has no commits yet."]);
  });

  it("says when there are uncommitted changes", () => {
    expect(repoInspectionLines(inspection({ dirty: true }))).toContain("There are uncommitted changes.");
  });

  it("uses the mock bridge result", async () => {
    const bridge = createMockBridge();
    const lines = repoInspectionLines(await bridge.inspectRepo("D:/repos/demo"));
    expect(lines.join(" ")).toMatch(/main/);
    expect(lines.join(" ")).not.toMatch(/not a git repository/i);
  });
});
