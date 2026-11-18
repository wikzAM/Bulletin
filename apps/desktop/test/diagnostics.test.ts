import { describe, expect, it } from "vitest";
import { buildDiagnosticsText, type DiagnosticsInfo } from "../src/lib/diagnostics";

const info: DiagnosticsInfo = {
  appVersion: "0.0.0",
  sidecarStatus: "ok",
  dataFolder: "D:/bulletin-data",
};

describe("buildDiagnosticsText", () => {
  it("lists version, sidecar status, and data folder without secrets", () => {
    const text = buildDiagnosticsText(info);
    expect(text).toContain("0.0.0");
    expect(text).toContain("ok");
    expect(text).toContain("D:/bulletin-data");
    expect(text.toLowerCase()).not.toContain("secret");
    expect(text.toLowerCase()).not.toContain("token");
    expect(text.toLowerCase()).not.toContain("key=");
  });
});
