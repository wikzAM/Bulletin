import { describe, expect, it } from "vitest";
import { BULLETIN_TOOLS, normalizeQuestion } from "./index";

describe("bulletin tool contracts", () => {
  it("normalises questions for the cache", () => {
    expect(normalizeQuestion("  What   PORT\ndoes the API use? ")).toBe("what port does the api use?");
  });

  it("caps bulletin_wait at 600 seconds", () => {
    expect(BULLETIN_TOOLS.bulletin_wait.safeParse({ dispatch_id: "d1", timeout_s: 601 }).success).toBe(false);
    expect(BULLETIN_TOOLS.bulletin_wait.safeParse({ dispatch_id: "d1", timeout_s: 600 }).success).toBe(true);
  });
});
