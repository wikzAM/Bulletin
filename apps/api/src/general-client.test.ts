import { describe, expect, it } from "vitest";
import type { ModelClient, ModelRequest, ModelResponse } from "@bulletin/models";
import { createGeneralCall } from "./routes/general-model";
import { modelCallFactory, modelClientCall, withFallback } from "./general";

const usage = { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 };

function client(reply: (req: ModelRequest) => ModelResponse | Promise<ModelResponse>): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    provider: "anthropic",
    requests,
    async complete(req) {
      requests.push(req);
      return reply(req);
    },
  };
}
const text = (t: string, stop_reason = "end_turn"): ModelResponse => ({ stop_reason, usage, content: [{ type: "text", text: t }] });

describe("modelClientCall", () => {
  it("sends the system prompt and the user message with no tools, and returns the reply text", async () => {
    const c = client(() => text('{"ok":true}'));
    const call = modelClientCall(c, "claude-fable-5-2");
    expect(await call("SYS", "USER")).toBe('{"ok":true}');
    expect(c.requests).toHaveLength(1);
    expect(c.requests[0]).toMatchObject({
      model: "claude-fable-5-2",
      system: "SYS",
      messages: [{ role: "user", content: "USER" }],
      tools: [],
    });
    expect(c.requests[0]!.max_tokens).toBeGreaterThanOrEqual(8000);
  });

  it("joins several text blocks and skips thinking blocks", async () => {
    const c = client(() => ({
      stop_reason: "end_turn",
      usage,
      content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "a" }, { type: "text", text: "b" }],
    }));
    expect(await modelClientCall(c, "m")("s", "u")).toBe("ab");
  });

  it("fails on a refusal, so withFallback can move to the next model", async () => {
    const refuse = modelClientCall(client(() => text("", "refusal")), "primary");
    const backup = modelClientCall(client(() => text("plan")), "backup");
    await expect(refuse("s", "u")).rejects.toThrow(/refus/i);
    const seen: string[] = [];
    expect(await withFallback(refuse, backup, (why) => seen.push(why))("s", "u")).toBe("plan");
    expect(seen).toHaveLength(1);
  });

  it("fails when the reply was cut off at max_tokens, rather than hand back half a JSON object", async () => {
    await expect(modelClientCall(client(() => text('{"units": [', "max_tokens")), "m")("s", "u")).rejects.toThrow(/max_tokens/);
  });

  it("fails on an empty reply", async () => {
    await expect(modelClientCall(client(() => text("")), "m")("s", "u")).rejects.toThrow(/no text/i);
  });

  it("passes provider errors through unchanged", async () => {
    const c = client(() => Promise.reject(new Error("429 slow down")));
    await expect(modelClientCall(c, "m")("s", "u")).rejects.toThrow("429 slow down");
  });
});

describe("modelCallFactory", () => {
  it("uses the injected client for BULLETIN_PROVIDER, one model call per role model", async () => {
    const c = client(() => text("hi"));
    const make = modelCallFactory({ BULLETIN_PROVIDER: "anthropic" }, { client: c });
    expect(await make("model-a")("s", "u")).toBe("hi");
    expect(c.requests[0]!.model).toBe("model-a");
  });

  it("composes with createGeneralCall: primary fails, fallback model answers", async () => {
    const c = client((req) => (req.model === "primary" ? Promise.reject(new Error("no credits")) : text("from fallback")));
    const call = createGeneralCall({ model: "primary", fallback: "backup" }, modelCallFactory({ BULLETIN_PROVIDER: "anthropic" }, { client: c }));
    expect(await call("s", "u")).toBe("from fallback");
    expect(c.requests.map((r) => r.model)).toEqual(["primary", "backup"]);
  });

  it("falls back to the Claude Code CLI call when no provider is chosen", () => {
    const make = modelCallFactory({}, {});
    expect(typeof make("m")).toBe("function"); // built, not run: it would spawn the CLI
  });

  it("rejects an unknown provider by variable name", () => {
    expect(() => modelCallFactory({ BULLETIN_PROVIDER: "other" }, {})).toThrow(/BULLETIN_PROVIDER/);
  });
});
