import { describe, expect, it } from "vitest";
import { buildPrompt, parseStreamLine } from "./claude-code-runner";

describe("parseStreamLine", () => {
  it("maps a tool_use block", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "a.ts" } }] } });
    expect(parseStreamLine(line, "m")).toEqual([{ type: "tool_use", tool: "Write", summary: "a.ts" }]);
  });
  it("maps a success result to usage and done", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 1 } });
    const [usage, done] = parseStreamLine(line, "m");
    expect(usage).toMatchObject({ type: "usage", model: "m", usage: { input_tokens: 5, output_tokens: 2, cache_read_tokens: 1, cache_write_tokens: 0 } });
    expect(done).toMatchObject({ type: "done", ok: true });
  });
  it("maps an error result to a failed done", () => {
    const line = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "boom" });
    expect(parseStreamLine(line, "m").at(-1)).toMatchObject({ type: "done", ok: false, error: "boom" });
  });
  it("ignores junk", () => {
    expect(parseStreamLine("not json", "m")).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("includes scope, acceptance and the send-back", () => {
    const p = buildPrompt({
      missionId: "m", attempt: 2, baseBranch: "b", briefingSlice: "", rules: "", model: "x", allowanceCents: 100,
      sendBack: "fix the thing",
      unit: { id: "u1", title: "t", task: "do it", files: ["src/**"], acceptance: ["pnpm test"] } as never,
    });
    expect(p).toContain("src/**");
    expect(p).toContain("pnpm test");
    expect(p).toContain("fix the thing");
  });
});
