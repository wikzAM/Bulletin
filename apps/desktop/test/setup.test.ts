import { describe, expect, it, vi } from "vitest";
import {
  checklistItems,
  secretNameForProvider,
  setupReady,
  type SetupDraft,
} from "../src/lib/setup";
import { createMockBridge } from "../src/lib/desktop-bridge";

const base: SetupDraft = {
  gitFound: true,
  claudeCliFound: true,
  claudeLoggedIn: true,
  provider: "anthropic-key",
  repoPath: "D:/repos/demo",
  secretSaved: true,
};

describe("setup checklist", () => {
  it("lists git, Claude Code CLI, login, provider, repo, and secret when needed", () => {
    const items = checklistItems(base);
    expect(items.map((i) => i.id)).toEqual(["git", "claude-cli", "claude-login", "provider", "repo", "secret"]);
    expect(items.every((i) => i.ok)).toBe(true);
  });

  it("skips the secret row when the provider is Claude Code login", () => {
    const items = checklistItems({ ...base, provider: "claude-code", secretSaved: false });
    expect(items.find((i) => i.id === "secret")).toBeUndefined();
    expect(setupReady({ ...base, provider: "claude-code", secretSaved: false })).toBe(true);
  });

  it("is not ready until every required row is ok", () => {
    expect(setupReady({ ...base, gitFound: false })).toBe(false);
    expect(setupReady({ ...base, provider: null, secretSaved: false })).toBe(false);
    expect(setupReady({ ...base, repoPath: "  " })).toBe(false);
    expect(setupReady(base)).toBe(true);
  });

  it("names the keychain entry for each provider that stores a secret", () => {
    expect(secretNameForProvider("anthropic-key")).toBe("ANTHROPIC_API_KEY");
    expect(secretNameForProvider("bedrock")).toBe("AWS_BEARER_TOKEN_BEDROCK");
    expect(secretNameForProvider("claude-code")).toBeNull();
  });
});

describe("mock desktop bridge", () => {
  it("stores a secret without returning the value, and can pick a folder", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const bridge = createMockBridge({ folder: "D:/picked" });
    await bridge.secretSet("ANTHROPIC_API_KEY", "sk-secret-value");
    expect(await bridge.secretHas("ANTHROPIC_API_KEY")).toBe(true);
    expect(await bridge.pickFolder()).toBe("D:/picked");
    expect(JSON.stringify(bridge)).not.toContain("sk-secret-value");
    expect(log.mock.calls.flat().join(" ")).not.toContain("sk-secret-value");
    log.mockRestore();
  });
});
