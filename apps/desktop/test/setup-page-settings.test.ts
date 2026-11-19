import { describe, expect, it } from "vitest";
import { regionToSave, saveSetup, settingsToSave } from "../src/pages/SetupPage.settings";
import { createMockBridge } from "../src/lib/desktop-bridge";
import { showsAwsRegion, type SetupDraft } from "../src/lib/setup";

const draft: SetupDraft = {
  gitFound: true,
  claudeCliFound: true,
  claudeLoggedIn: true,
  provider: "anthropic-key",
  repoPath: "  D:/repos/demo  ",
  secretSaved: true,
};

describe("what first-run setup saves", () => {
  it("is the provider, the repository folder and that setup is complete, and never a secret", () => {
    expect(settingsToSave(draft)).toEqual({ provider: "anthropic-key", repo_path: "D:/repos/demo", setup_complete: true });
    expect(settingsToSave({ ...draft, provider: "claude-code" }).provider).toBe("claude-code");
    expect(settingsToSave({ ...draft, provider: "bedrock" }).provider).toBe("bedrock");
  });

  it("refuses to save a setup that has no provider", () => {
    expect(() => settingsToSave({ ...draft, provider: null })).toThrow(/provider/i);
  });

  it("saveSetup stores it through the bridge so the sidecar reads the provider", async () => {
    const bridge = createMockBridge();
    await saveSetup(bridge, draft);
    expect(await bridge.getSettings()).toEqual({ provider: "anthropic-key", repo_path: "D:/repos/demo", setup_complete: true });
  });
});

describe("Amazon Bedrock region", () => {
  it("shows the region field only when Bedrock is chosen", () => {
    expect(showsAwsRegion("bedrock")).toBe(true);
    expect(showsAwsRegion("anthropic-key")).toBe(false);
    expect(showsAwsRegion("claude-code")).toBe(false);
    expect(showsAwsRegion(null)).toBe(false);
  });

  it("saves the region on its own as aws_region", async () => {
    expect(regionToSave({ ...draft, provider: "bedrock", awsRegion: " us-west-2 " })).toEqual({ aws_region: "us-west-2" });
    expect(regionToSave({ ...draft, provider: "anthropic-key", awsRegion: "us-west-2" })).toBeNull();
    expect(regionToSave({ ...draft, provider: "bedrock", awsRegion: "  " })).toBeNull();
    const bridge = createMockBridge();
    await saveSetup(bridge, { ...draft, provider: "bedrock", awsRegion: "us-west-2", secretSaved: true });
    expect(await bridge.getSettings()).toMatchObject({ provider: "bedrock", aws_region: "us-west-2" });
  });
});
