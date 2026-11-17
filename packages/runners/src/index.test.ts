import { describe, expect, it } from "vitest";
import { attemptBranch, integrationBranch } from "./index";

describe("branch names", () => {
  it("follow the spec", () => {
    expect(integrationBranch("m1")).toBe("bulletin/m1/integration");
    expect(attemptBranch("m1", "u4", 2)).toBe("bulletin/m1/u4-a2");
  });
});
