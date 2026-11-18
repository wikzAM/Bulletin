/** Persisted window chrome. Browser mock uses localStorage; Tauri will use the settings command. */
export interface WindowSettings {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

export const DEFAULT_WINDOW: WindowSettings = { width: 1200, height: 800, x: null, y: null };

export const WINDOW_SETTINGS_KEY = "bulletin.window";

export interface SettingsStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export function createMemoryStore(initial: Record<string, unknown> = {}): SettingsStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    async set(key, value) {
      data.set(key, value);
    },
  };
}

/** Browser fallback behind the transport: localStorage JSON. */
export function createLocalSettingsStore(storage: Storage = globalThis.localStorage): SettingsStore {
  return {
    async get(key) {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      storage.setItem(key, JSON.stringify(value));
    },
  };
}

export async function readWindowSettings(store: SettingsStore): Promise<WindowSettings> {
  const raw = await store.get(WINDOW_SETTINGS_KEY);
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WINDOW };
  const o = raw as Record<string, unknown>;
  return {
    width: typeof o.width === "number" ? o.width : DEFAULT_WINDOW.width,
    height: typeof o.height === "number" ? o.height : DEFAULT_WINDOW.height,
    x: typeof o.x === "number" ? o.x : null,
    y: typeof o.y === "number" ? o.y : null,
  };
}

export async function writeWindowSettings(store: SettingsStore, value: WindowSettings): Promise<void> {
  await store.set(WINDOW_SETTINGS_KEY, value);
}

export type ShortcutAction = "new-project" | "focus-search" | "dismiss";

export function parseShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape") return "dismiss";
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") return "new-project";
  if (mod && !e.altKey && !e.shiftKey && e.key === "/") return "focus-search";
  return null;
}
