import { describe, expect, it, vi } from "vitest";
import { createMockBridge, createTauriBridge, type EnvironmentProbe } from "../src/lib/desktop-bridge";

/** A fake Tauri host: `rpc` goes to a sidecar method table, other commands to a command table. */
function host(options: {
  rpc?: Record<string, (params: Record<string, unknown>) => unknown>;
  commands?: Record<string, (args: Record<string, unknown>) => unknown>;
} = {}) {
  const log: { cmd: string; args: Record<string, unknown> }[] = [];
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    log.push({ cmd, args });
    if (cmd === "rpc") {
      const { method, params } = args as { method: string; params: Record<string, unknown> };
      const handler = options.rpc?.[method];
      if (!handler) throw { code: -32601, message: "Method not found" };
      return handler(params);
    }
    const command = options.commands?.[cmd];
    if (!command) throw `Command ${cmd} not found`;
    return command(args);
  });
  return { invoke, log };
}

const CHECK = {
  git: { found: true, version: "git version 2.51.0" },
  claude: { found: true, logged_in: false },
  provider: { id: "claude-code", ready: false, env: {} },
};

describe("Tauri desktop bridge", () => {
  it("probeEnvironment asks the sidecar's env.check and maps it to the first-run flags", async () => {
    const h = host({ rpc: { "env.check": () => CHECK } });
    const bridge = createTauriBridge(h);
    expect(await bridge.probeEnvironment()).toEqual({ gitFound: true, claudeCliFound: true, claudeLoggedIn: false } satisfies EnvironmentProbe);
    expect(h.log).toEqual([{ cmd: "rpc", args: { method: "env.check", params: {} } }]);
  });

  it("probeEnvironment waits out a sidecar that is still starting, and reports nothing found if it never answers", async () => {
    let tries = 0;
    const starting = host({
      rpc: {
        "env.check": () => {
          tries += 1;
          if (tries < 3) throw { code: -32000, message: "Sidecar unavailable" };
          return CHECK;
        },
      },
    });
    expect(await createTauriBridge({ ...starting, retryDelayMs: 1 }).probeEnvironment()).toMatchObject({ gitFound: true });
    expect(tries).toBe(3);

    const dead = host({
      rpc: {
        "env.check": () => {
          throw { code: -32000, message: "Sidecar unavailable" };
        },
      },
    });
    expect(await createTauriBridge({ ...dead, retryDelayMs: 1, attempts: 3 }).probeEnvironment()).toEqual({
      gitFound: false,
      claudeCliFound: false,
      claudeLoggedIn: false,
    });
    expect(dead.invoke).toHaveBeenCalledTimes(3);

    const odd = host({ rpc: { "env.check": () => ({ nonsense: true }) } });
    expect(await createTauriBridge(odd).probeEnvironment()).toEqual({ gitFound: false, claudeCliFound: false, claudeLoggedIn: false });
  });

  it("secretSet stores through the keychain command, then waits for the restarted sidecar; the value goes nowhere else", async () => {
    let healthChecks = 0;
    const h = host({
      commands: { secret_set: () => null },
      rpc: {
        health: () => {
          healthChecks += 1;
          if (healthChecks < 3) throw { code: -32000, message: "Sidecar unavailable" };
          return { status: "ok" };
        },
      },
    });
    const bridge = createTauriBridge({ ...h, retryDelayMs: 1 });
    await bridge.secretSet("ANTHROPIC_API_KEY", "sk-ant-secret-value");
    expect(h.log[0]).toEqual({ cmd: "secret_set", args: { name: "ANTHROPIC_API_KEY", value: "sk-ant-secret-value" } });
    expect(h.log.slice(1).map((entry) => entry.args.method)).toEqual(["health", "health", "health"]);
    expect(JSON.stringify(h.log.slice(1))).not.toContain("sk-ant-secret-value");
  });

  it("secretSet fails with the keychain's reason and never repeats the value", async () => {
    const h = host({
      commands: {
        secret_set: () => {
          throw "Could not write the system keychain";
        },
      },
    });
    const error = await createTauriBridge(h).secretSet("ANTHROPIC_API_KEY", "sk-ant-secret-value").then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Could not write the system keychain");
    expect(h.log.map((entry) => entry.cmd)).toEqual(["secret_set"]);
  });

  it("secretHas asks the keychain command; pickFolder returns null where there is no picker", async () => {
    const h = host({ commands: { secret_has: (args) => args.name === "ANTHROPIC_API_KEY" } });
    const bridge = createTauriBridge(h);
    expect(await bridge.secretHas("ANTHROPIC_API_KEY")).toBe(true);
    expect(await bridge.secretHas("BULLETIN_GITHUB_TOKEN")).toBe(false);
    expect(await bridge.pickFolder()).toBeNull();

    const picker = host({ commands: { pick_folder: () => "D:/work/demo" } });
    expect(await createTauriBridge(picker).pickFolder()).toBe("D:/work/demo");
  });

  it("a changed provider restarts the sidecar (it reads the provider at start) and waits for it; other changes do not", async () => {
    let stored: Record<string, unknown> = { provider: "claude-code" };
    const h = host({
      commands: { restart_sidecar: () => null },
      rpc: {
        "settings.get": () => ({ settings: { ...stored } }),
        "settings.set": (params) => {
          for (const [k, v] of Object.entries(params.values as Record<string, unknown>)) {
            if (v === null) delete stored[k];
            else stored[k] = v;
          }
          return { settings: { ...stored } };
        },
        health: () => ({ status: "ok" }),
      },
    });
    const bridge = createTauriBridge({ ...h, retryDelayMs: 1 });
    await bridge.setSettings({ repo_path: "D:/work/demo", setup_complete: true });
    expect(h.log.map((e) => e.cmd === "rpc" ? e.args.method : e.cmd)).toEqual(["settings.set"]);

    h.log.length = 0;
    await bridge.setSettings({ provider: "claude-code" });
    expect(h.log.map((e) => e.cmd === "rpc" ? e.args.method : e.cmd)).toEqual(["settings.get", "settings.set"]);

    h.log.length = 0;
    await bridge.setSettings({ provider: "bedrock" });
    expect(h.log.map((e) => e.cmd === "rpc" ? e.args.method : e.cmd)).toEqual(["settings.get", "settings.set", "restart_sidecar", "health"]);
    stored = {};
  });

  it("inspectRepo and settings go to the sidecar's repo.inspect and settings methods", async () => {
    const info = { path: "D:/work/demo", exists: true, is_repo: true, root: "D:/work/demo", branch: "main", dirty: false, test_command: "npm test", file_count: 3, file_count_capped: false };
    const h = host({
      commands: { restart_sidecar: () => null },
      rpc: {
        health: () => ({ status: "ok" }),
        "repo.inspect": () => info,
        "settings.get": () => ({ settings: { provider: "bedrock" } }),
        "settings.set": (params) => ({ settings: params.values }),
      },
    });
    const bridge = createTauriBridge(h);
    expect(await bridge.inspectRepo("D:/work/demo")).toEqual(info);
    expect(await bridge.getSettings()).toEqual({ provider: "bedrock" });
    expect(await bridge.setSettings({ repo_path: "D:/work/demo", provider: null })).toEqual({ repo_path: "D:/work/demo", provider: null });
    expect(h.log.map((entry) => entry.args)).toEqual([
      { method: "repo.inspect", params: { path: "D:/work/demo" } },
      { method: "settings.get", params: {} },
      { method: "settings.get", params: {} },
      { method: "settings.set", params: { values: { repo_path: "D:/work/demo", provider: null } } },
      {},
      { method: "health", params: {} },
    ]);
  });

  it("surfaces a sidecar refusal as an error carrying its code", async () => {
    const h = host({
      rpc: {
        "repo.inspect": () => {
          throw { code: -32602, message: "Expected an absolute folder path" };
        },
      },
    });
    await expect(createTauriBridge(h).inspectRepo("relative")).rejects.toMatchObject({ code: -32602, message: "Expected an absolute folder path" });
  });
});

describe("mock desktop bridge", () => {
  it("answers inspectRepo and settings in memory, like the app would", async () => {
    const bridge = createMockBridge();
    expect(await bridge.inspectRepo("D:/work/demo")).toMatchObject({ path: "D:/work/demo", exists: true, is_repo: true });
    expect(await bridge.getSettings()).toEqual({});
    expect(await bridge.setSettings({ provider: "bedrock", repo_path: "D:/x" })).toEqual({ provider: "bedrock", repo_path: "D:/x" });
    expect(await bridge.setSettings({ provider: null })).toEqual({ repo_path: "D:/x" });
    expect(await bridge.getSettings()).toEqual({ repo_path: "D:/x" });
  });
});
