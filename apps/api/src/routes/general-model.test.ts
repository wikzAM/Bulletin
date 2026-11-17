import { expect, it, vi } from "vitest";
import { createGeneralCall } from "./general-model";

it("uses the configured fallback for the same request when the primary model call fails", async () => {
  const primary = vi.fn(async () => { throw new Error("primary credits unavailable"); });
  const fallback = vi.fn(async () => "proposal");
  const factory = vi.fn((model: string) => model === "primary" ? primary : fallback);
  const call = createGeneralCall({ model: "primary", fallback: "fallback" }, factory);

  await expect(call("system", "goal")).resolves.toBe("proposal");
  expect(factory.mock.calls).toEqual([["primary"], ["fallback"]]);
  expect(primary).toHaveBeenCalledExactlyOnceWith("system", "goal");
  expect(fallback).toHaveBeenCalledExactlyOnceWith("system", "goal");
});

it("keeps a successful primary response and uses the primary alone when no fallback is configured", async () => {
  const primary = vi.fn(async () => "primary proposal");
  const fallback = vi.fn(async () => "fallback proposal");
  const factory = vi.fn((model: string) => model === "primary" ? primary : fallback);

  await expect(createGeneralCall({ model: "primary", fallback: "fallback" }, factory)("system", "goal"))
    .resolves.toBe("primary proposal");
  expect(fallback).not.toHaveBeenCalled();

  factory.mockClear();
  expect(createGeneralCall({ model: "primary" }, factory)).toBe(primary);
  expect(factory).toHaveBeenCalledExactlyOnceWith("primary");
});
