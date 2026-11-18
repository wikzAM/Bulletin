/**
 * Desktop-only capabilities used by first-run setup (secrets + folder picker).
 * Mock in the browser; Tauri invoke/dialog in the app (docs/SIDECAR.md).
 */
export interface DesktopBridge {
  secretSet(name: string, value: string): Promise<void>;
  secretHas(name: string): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  probeEnvironment(): Promise<{ gitFound: boolean; claudeCliFound: boolean; claudeLoggedIn: boolean }>;
}

export function createMockBridge(opts: {
  folder?: string | null;
  env?: { gitFound: boolean; claudeCliFound: boolean; claudeLoggedIn: boolean };
} = {}): DesktopBridge {
  const secrets = new Set<string>();
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
  };
}

/** Tauri: secret_* commands and a folder dialog; falls back to mock probes in the browser. */
export async function createDesktopBridge(): Promise<DesktopBridge> {
  const g = globalThis as { __TAURI_INTERNALS__?: unknown };
  if (g.__TAURI_INTERNALS__ === undefined) return createMockBridge();
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    async secretSet(name, value) {
      await invoke("secret_set", { name, value });
    },
    async secretHas(name) {
      return invoke<boolean>("secret_has", { name });
    },
    async pickFolder() {
      try {
        const path = await invoke<string | null>("pick_folder", {});
        return path;
      } catch {
        return null;
      }
    },
    async probeEnvironment() {
      try {
        return await invoke<{ gitFound: boolean; claudeCliFound: boolean; claudeLoggedIn: boolean }>("probe_environment", {});
      } catch {
        return { gitFound: false, claudeCliFound: false, claudeLoggedIn: false };
      }
    },
  };
}
