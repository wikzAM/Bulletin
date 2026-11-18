import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WINDOW,
  parseShortcut,
  readWindowSettings,
  writeWindowSettings,
  type WindowSettings,
} from "../src/lib/window-settings";

describe("window settings store", () => {
  it("returns defaults when nothing is stored", async () => {
    const store = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
    expect(await readWindowSettings(store)).toEqual(DEFAULT_WINDOW);
  });

  it("round-trips size and remembers it", async () => {
    const memory = new Map<string, unknown>();
    const store = {
      get: async (key: string) => memory.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        memory.set(key, value);
      },
    };
    const next: WindowSettings = { width: 1280, height: 800, x: 40, y: 20 };
    await writeWindowSettings(store, next);
    expect(await readWindowSettings(store)).toEqual(next);
  });
});

describe("parseShortcut", () => {
  it("matches plain letters with modifiers for desktop actions", () => {
    expect(parseShortcut({ key: "n", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("new-project");
    expect(parseShortcut({ key: "n", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe("new-project");
    expect(parseShortcut({ key: "/", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("focus-search");
    expect(parseShortcut({ key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe("dismiss");
    expect(parseShortcut({ key: "n", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBeNull();
  });
});
