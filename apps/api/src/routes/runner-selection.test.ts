import { afterEach, expect, it, vi } from "vitest";
import { managedRunner } from "../runners";
import { createRunnerFactory } from "./runner-selection";

vi.mock("../runners", () => ({ managedRunner: vi.fn() }));

afterEach(() => vi.clearAllMocks());

it.each([undefined, "claude"])("selects Claude Code for %s", (BULLETIN_RUNNER) => {
  const createRunner = createRunnerFactory({ BULLETIN_RUNNER }, "/bulletin");
  expect(createRunner("/repo", "/scratch").kind).toBe("local-claude-code");
  expect(managedRunner).not.toHaveBeenCalled();
});

it("passes the sandbox repository to the shared managed runner when a mission starts", () => {
  const sandboxRepo = "https://github.com/example/sandbox";
  const expectedRunner = { kind: "managed-agents" } as ReturnType<typeof managedRunner>;
  vi.mocked(managedRunner).mockReturnValue(expectedRunner);
  const createRunner = createRunnerFactory({ BULLETIN_RUNNER: "managed", BULLETIN_SANDBOX_REPO: sandboxRepo }, "/bulletin");
  expect(managedRunner).not.toHaveBeenCalled();
  expect(createRunner("/repo", "/scratch")).toBe(expectedRunner);
  expect(managedRunner).toHaveBeenCalledExactlyOnceWith("/repo", "/bulletin", sandboxRepo);
});

it("rejects unknown runners and managed setups without a sandbox repository", () => {
  expect(() => createRunnerFactory({ BULLETIN_RUNNER: "invalid" }, "/bulletin")).toThrow("BULLETIN_RUNNER must be claude or managed");
  expect(() => createRunnerFactory({ BULLETIN_RUNNER: "managed" }, "/bulletin")).toThrow("BULLETIN_SANDBOX_REPO is required");
  expect(managedRunner).not.toHaveBeenCalled();
});
