import { describe, expect, it } from "vitest";
import { ModelsConfigSchema } from "./config";

const base = { roles: { station: { model: "claude-sonnet-5-5" } }, tiers: { station: "claude-sonnet-5-5" } };

describe("ModelsConfigSchema providers section", () => {
  it("still accepts a config without one", () => {
    expect(ModelsConfigSchema.parse(base).providers).toBeUndefined();
  });

  it("accepts exact Bedrock ids per model", () => {
    const parsed = ModelsConfigSchema.parse({
      ...base,
      providers: { bedrock: { models: { "claude-sonnet-5-5": "anthropic.claude-sonnet-5-5-v2:0" } } },
    });
    expect(parsed.providers?.bedrock?.models["claude-sonnet-5-5"]).toBe("anthropic.claude-sonnet-5-5-v2:0");
  });

  it("rejects an empty Bedrock id", () => {
    expect(() => ModelsConfigSchema.parse({ ...base, providers: { bedrock: { models: { x: "" } } } })).toThrow();
  });
});
