import { afterEach, expect, it, vi } from "vitest";
import { sdkRunner } from "../runners";
import { createRunnerFactory } from "./runner-selection";

vi.mock("../runners", () => ({ managedRunner: vi.fn(), sdkRunner: vi.fn() }));

afterEach(() => vi.clearAllMocks());

it("selects the SDK station runner for BULLETIN_RUNNER=sdk, built when a mission starts", async () => {
  const expected = { kind: "sdk-station" } as Awaited<ReturnType<typeof sdkRunner>>;
  vi.mocked(sdkRunner).mockResolvedValue(expected);
  const createRunner = createRunnerFactory({ BULLETIN_RUNNER: "sdk" }, "/bulletin");
  expect(sdkRunner).not.toHaveBeenCalled();
  expect(await createRunner("/repo", "/scratch")).toBe(expected);
  expect(sdkRunner).toHaveBeenCalledExactlyOnceWith("/repo", "/scratch", "/bulletin");
});

it("names all three runners when the value is unknown", () => {
  expect(() => createRunnerFactory({ BULLETIN_RUNNER: "invalid" }, "/bulletin")).toThrow("claude or managed, or sdk");
});
