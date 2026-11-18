import { asRpcError, RpcError, SIDECAR_UNAVAILABLE, type TauriInvoke } from "./transport";

/**
 * Desktop-only capabilities used by first-run setup: secrets, a folder picker, what the machine has, and the
 * non-secret settings. Mock in the browser; in the app these are the Tauri commands and the sidecar's first-run
 * methods (docs/SIDECAR.md).
 */
export interface EnvironmentProbe {
  gitFound: boolean;
  claudeCliFound: boolean;
  claudeLoggedIn: boolean;
}

/** `repo.inspect` (docs/SIDECAR.md). */
export interface RepoInspection {
  path: string;
  exists: boolean;
  is_repo: boolean;
  root: string | null;
  branch: string | null;
  dirty: boolean | null;
  test_command: string | null;
  file_count: number | null;
  file_count_capped: boolean;
}

/** Settings the app keeps (docs/SIDECAR.md, `settings.get`): provider, repo_path, setup_complete. Never a secret. */
export type AppSettings = Record<string, string | boolean>;
export type SettingsChange = Record<string, string | boolean | null>;

export interface DesktopBridge {
  secretSet(name: string, value: string): Promise<void>;
  secretHas(name: string): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  probeEnvironment(): Promise<EnvironmentProbe>;
  inspectRepo(path: string): Promise<RepoInspection>;
  getSettings(): Promise<AppSettings>;
  setSettings(values: SettingsChange): Promise<AppSettings>;
}

const NOTHING_FOUND: EnvironmentProbe = { gitFound: false, claudeCliFound: false, claudeLoggedIn: false };

export function createMockBridge(opts: {
  folder?: string | null;
  env?: EnvironmentProbe;
} = {}): DesktopBridge {
  const secrets = new Set<string>();
  let settings: AppSettings = {};
  return {
    async secretSet(name, value) {
      if (!name || !value) throw new Error("name and value required");
      // Never log the value.
      secrets.add(name);
    },
    async secretHas(name) {
      return secrets.has(name);
    },
    async pickFolder() {
      return opts.folder ?? null;
    },
    async probeEnvironment() {
      return opts.env ?? { gitFound: true, claudeCliFound: true, claudeLoggedIn: true };
    },
    async inspectRepo(path) {
      return { path, exists: true, is_repo: true, root: path, branch: "main", dirty: false, test_command: "npm test", file_count: 1, file_count_capped: false };
    },
    async getSettings() {
      return { ...settings };
    },
    async setSettings(values) {
      const next = { ...settings };
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      settings = next;
      return { ...settings };
    },
  };
}

function validProbe(value: unknown): value is { git: { found: boolean }; claude: { found: boolean; logged_in: boolean } } {
  const v = value as { git?: { found?: unknown }; claude?: { found?: unknown; logged_in?: unknown } } | null;
  return typeof v?.git?.found === "boolean" && typeof v.claude?.found === "boolean" && typeof v.claude.logged_in === "boolean";
}

/**
 * The Tauri side: the keychain commands (`secret_*`), a folder dialog when the app has one, and the sidecar's
 * `env.check`, `repo.inspect` and `settings.*` methods through the `rpc` command. A call made while the sidecar is
 * starting or restarting (-32000) is repeated a few times.
 */
export function createTauriBridge(opts: { invoke: TauriInvoke; retryDelayMs?: number; attempts?: number }): DesktopBridge {
  const delay = opts.retryDelayMs ?? 300;
  const attempts = opts.attempts ?? 10;
  const pause = () => new Promise((resolve) => setTimeout(resolve, delay));

  async function rpc(method: string, params: Record<string, unknown> = {}, tries = attempts): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await opts.invoke("rpc", { method, params });
      } catch (raw) {
        const error = asRpcError(raw);
        if (error instanceof RpcError && error.code === SIDECAR_UNAVAILABLE && attempt < tries) {
          await pause();
          continue;
        }
        throw error;
      }
    }
  }

  return {
    async secretSet(name, value) {
      try {
        await opts.invoke("secret_set", { name, value });
      } catch (error) {
        // The keychain's reason is a short fixed sentence; the value is never part of it.
        throw typeof error === "string" ? new Error(error) : error instanceof Error ? error : new Error("Could not save the secret");
      }
      // A changed secret restarts the sidecar so it can read it; wait until it answers again.
      await rpc("health", {}, 40).catch(() => undefined);
    },

    async secretHas(name) {
      return (await opts.invoke("secret_has", { name })) === true;
    },

    async pickFolder() {
      try {
        const path = await opts.invoke("pick_folder", {});
        return typeof path === "string" ? path : null;
      } catch {
        return null;
      }
    },

    async probeEnvironment() {
      try {
        const result = await rpc("env.check");
        if (!validProbe(result)) return NOTHING_FOUND;
        return { gitFound: result.git.found, claudeCliFound: result.claude.found, claudeLoggedIn: result.claude.logged_in };
      } catch {
        return NOTHING_FOUND;
      }
    },

    async inspectRepo(path) {
      return (await rpc("repo.inspect", { path })) as RepoInspection;
    },

    async getSettings() {
      return ((await rpc("settings.get")) as { settings: AppSettings }).settings;
    },

    async setSettings(values) {
      // The sidecar reads the provider when it starts, so a changed provider means a restart.
      const before = "provider" in values ? await this.getSettings() : null;
      const after = ((await rpc("settings.set", { values })) as { settings: AppSettings }).settings;
      if (before && (before.provider ?? null) !== (after.provider ?? null)) {
        await opts.invoke("restart_sidecar", {});
        await rpc("health", {}, 40).catch(() => undefined);
      }
      return after;
    },
  };
}

/** Tauri: secret_* commands and the sidecar methods; the mock in the browser. */
export async function createDesktopBridge(): Promise<DesktopBridge> {
  const g = globalThis as { __TAURI_INTERNALS__?: unknown };
  if (g.__TAURI_INTERNALS__ === undefined) return createMockBridge();
  const { invoke } = await import("@tauri-apps/api/core");
  return createTauriBridge({ invoke: (cmd, args) => invoke<unknown>(cmd, args) });
}
