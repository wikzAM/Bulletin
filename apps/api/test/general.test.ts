import { describe, expect, it } from "vitest";
import { DEFAULT_LANES } from "@bulletin/core";
import { extractJson, runGeneral, type ModelCall } from "../src/general";

const ctx = {
  repoFiles: ["src/a.ts"],
  lanes: DEFAULT_LANES,
  allowedCommands: ["pnpm *", "node *"],
};
const good = {
  briefing_version: 1,
  units: [{ id: "u1", title: "t", task: "do", files: ["src/new.ts"], acceptance: ["pnpm test"], needs: [] }],
};
const input = { briefing: "build x", repoMap: "src/a.ts", rules: "", lessons: "", validation: ctx };

describe("extractJson", () => {
  it("reads plain JSON and fenced JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it("throws on junk", () => {
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("runGeneral", () => {
  it("returns a valid plan on the first try", async () => {
    const call: ModelCall = async () => JSON.stringify(good);
    const r = await runGeneral(input, call);
    expect(r.ok).toBe(true);
  });
  it("retries once with the validation errors as feedback", async () => {
    const seen: string[] = [];
    const call: ModelCall = async (_sys, user) => {
      seen.push(user);
      return seen.length === 1 ? JSON.stringify({ briefing_version: 1, units: [] }) : JSON.stringify(good);
    };
    const r = await runGeneral(input, call);
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("REVISE THE PREVIOUS PLAN");
  });
  it("gives up after the retry and reports errors", async () => {
    const call: ModelCall = async () => "not json at all";
    const r = await runGeneral(input, call);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("withFallback", () => {
  it("uses the fallback when the primary call throws", async () => {
    const { withFallback } = await import("../src/general");
    const why: string[] = [];
    const call = withFallback(
      async () => {
        throw new Error("no credits");
      },
      async () => "ok",
      (w) => why.push(w),
    );
    expect(await call("s", "u")).toBe("ok");
    expect(why).toEqual(["no credits"]);
  });
});
