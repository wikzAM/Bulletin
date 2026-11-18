import { describe, expect, it } from "vitest";
import {
  bedrockModelId,
  createModelClient,
  createSdkModelClient,
  missingCredentialNames,
  selectProvider,
  type ModelRequest,
  type SdkLike,
} from "./index";

const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  model: "claude-sonnet-5-5",
  system: "be brief",
  messages: [{ role: "user", content: "hi" }],
  tools: [{ name: "read_file", description: "d", input_schema: { type: "object" } }],
  max_tokens: 100,
  ...extra,
});

/** A fake SDK client that records exactly what it was called with. */
function fakeSdk(reply: Record<string, unknown> = {}) {
  const calls: Array<{ body: Record<string, unknown>; options: Record<string, unknown> | undefined }> = [];
  const sdk: SdkLike = {
    messages: {
      async create(body, options) {
        calls.push({ body: body as unknown as Record<string, unknown>, options: options as Record<string, unknown> | undefined });
        return {
          content: [{ type: "text", text: "hello" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
          ...reply,
        };
      },
    },
  };
  return { sdk, calls };
}

describe("selectProvider", () => {
  it("defaults to anthropic", () => {
    expect(selectProvider({})).toBe("anthropic");
    expect(selectProvider({ BULLETIN_PROVIDER: "" })).toBe("anthropic");
  });
  it("accepts anthropic and bedrock, ignoring case and spaces", () => {
    expect(selectProvider({ BULLETIN_PROVIDER: " Bedrock " })).toBe("bedrock");
    expect(selectProvider({ BULLETIN_PROVIDER: "anthropic" })).toBe("anthropic");
  });
  it("names the variable, not the value, when it is unknown", () => {
    try {
      selectProvider({ BULLETIN_PROVIDER: "super-secret-looking-value" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("BULLETIN_PROVIDER");
      expect((e as Error).message).not.toContain("super-secret-looking-value");
    }
  });
});

describe("bedrockModelId", () => {
  it("adds the anthropic. prefix to the model id from config", () => {
    expect(bedrockModelId("claude-sonnet-5-5")).toBe("anthropic.claude-sonnet-5-5");
  });
  it("does not double the prefix", () => {
    expect(bedrockModelId("anthropic.claude-sonnet-5-5")).toBe("anthropic.claude-sonnet-5-5");
  });
  it("lets config map a model to its exact Bedrock id", () => {
    expect(bedrockModelId("claude-sonnet-5-5", { "claude-sonnet-5-5": "anthropic.claude-sonnet-5-5-v2:0" })).toBe(
      "anthropic.claude-sonnet-5-5-v2:0",
    );
  });
});

describe("missingCredentialNames", () => {
  it("lists names only, for anthropic", () => {
    expect(missingCredentialNames("anthropic", () => false)).toEqual(["ANTHROPIC_API_KEY"]);
    expect(missingCredentialNames("anthropic", (n) => n === "ANTHROPIC_API_KEY")).toEqual([]);
  });
  it("needs a region and some AWS credential for bedrock", () => {
    expect(missingCredentialNames("bedrock", () => false)).toEqual([
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID or AWS_PROFILE or AWS_BEARER_TOKEN_BEDROCK",
    ]);
    expect(missingCredentialNames("bedrock", (n) => n === "AWS_REGION" || n === "AWS_PROFILE")).toEqual([]);
  });
});

describe("createSdkModelClient", () => {
  it("sends the request body without the abort signal, which goes in the per-request options", async () => {
    const { sdk, calls } = fakeSdk();
    const client = createSdkModelClient({ provider: "anthropic", sdk });
    const controller = new AbortController();
    await client.complete(request({ signal: controller.signal }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).not.toHaveProperty("signal");
    expect(calls[0]!.body).toMatchObject({ model: "claude-sonnet-5-5", system: "be brief", max_tokens: 100 });
    expect(calls[0]!.options?.signal).toBe(controller.signal);
  });

  it("maps usage to the core shape and defaults missing cache fields to 0", async () => {
    const { sdk } = fakeSdk();
    const client = createSdkModelClient({ provider: "anthropic", sdk });
    const response = await client.complete(request());
    expect(response.usage).toEqual({ input_tokens: 10, output_tokens: 5, cache_read_tokens: 3, cache_write_tokens: 2 });

    const bare = fakeSdk({ usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: null } });
    const r2 = await createSdkModelClient({ provider: "anthropic", sdk: bare.sdk }).complete(request());
    expect(r2.usage).toEqual({ input_tokens: 1, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 });
  });

  it("keeps thinking blocks verbatim and in order, because the next request must send them back unchanged", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };
    const redacted = { type: "redacted_thinking", data: "opaque" };
    const { sdk } = fakeSdk({
      content: [thinking, { type: "text", text: "ok" }, redacted, { type: "tool_use", id: "t1", name: "read_file", input: { path: "a" } }],
      stop_reason: "tool_use",
    });
    const response = await createSdkModelClient({ provider: "anthropic", sdk }).complete(request());
    expect(response.content).toEqual([
      thinking,
      { type: "text", text: "ok" },
      redacted,
      { type: "tool_use", id: "t1", name: "read_file", input: { path: "a" } },
    ]);
    expect(response.stop_reason).toBe("tool_use");
  });

  it("drops block types a station loop never uses, such as server-tool results", async () => {
    const { sdk } = fakeSdk({
      content: [
        { type: "web_search_tool_result", content: [] },
        { type: "text", text: "ok" },
      ],
    });
    const response = await createSdkModelClient({ provider: "anthropic", sdk }).complete(request());
    expect(response.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("uses the bedrock model id for the call", async () => {
    const { sdk, calls } = fakeSdk();
    const client = createSdkModelClient({ provider: "bedrock", sdk, resolveModel: (m) => bedrockModelId(m) });
    expect(client.provider).toBe("bedrock");
    await client.complete(request());
    expect(calls[0]!.body.model).toBe("anthropic.claude-sonnet-5-5");
  });

  it("omits tools when there are none, and does not mutate the request", async () => {
    const { sdk, calls } = fakeSdk();
    const req = request({ tools: [] });
    const before = JSON.stringify(req);
    await createSdkModelClient({ provider: "anthropic", sdk }).complete(req);
    expect(calls[0]!.body).not.toHaveProperty("tools");
    expect(JSON.stringify(req)).toBe(before);
  });

  it("lets SDK errors through unchanged", async () => {
    const sdk: SdkLike = { messages: { create: () => Promise.reject(new Error("429 rate limited")) } };
    await expect(createSdkModelClient({ provider: "anthropic", sdk }).complete(request())).rejects.toThrow("429 rate limited");
  });
});

describe("createModelClient", () => {
  it("builds the client for the selected provider from injected factories", () => {
    const made: string[] = [];
    const { sdk } = fakeSdk();
    const factories = {
      anthropic: () => (made.push("anthropic"), sdk),
      bedrock: (opts: { region: string }) => (made.push(`bedrock:${opts.region}`), sdk),
    };
    expect(createModelClient({ env: {}, factories }).provider).toBe("anthropic");
    const bedrock = createModelClient({ env: { BULLETIN_PROVIDER: "bedrock", AWS_REGION: "us-east-1" }, factories });
    expect(bedrock.provider).toBe("bedrock");
    expect(made).toEqual(["anthropic", "bedrock:us-east-1"]);
  });

  it("refuses bedrock without a region, naming the variable", () => {
    const { sdk } = fakeSdk();
    expect(() =>
      createModelClient({ env: { BULLETIN_PROVIDER: "bedrock" }, factories: { anthropic: () => sdk, bedrock: () => sdk } }),
    ).toThrow(/AWS_REGION/);
  });
});
