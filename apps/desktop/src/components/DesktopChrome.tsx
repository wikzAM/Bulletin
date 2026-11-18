import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  createLocalSettingsStore,
  parseShortcut,
  readWindowSettings,
  writeWindowSettings,
} from "../lib/window-settings";

/** Keyboard shortcuts and remember window size (local mock store until Tauri settings exist). */
export function DesktopChrome({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const store = createLocalSettingsStore();
    void readWindowSettings(store).then((s) => {
      if (typeof window === "undefined") return;
      // Apply remembered size only when not already constrained by the host.
      if (window.outerWidth < 400) window.resizeTo(s.width, s.height);
    });
    const onResize = () => {
      void writeWindowSettings(store, {
        width: window.outerWidth,
        height: window.outerHeight,
        x: window.screenX,
        y: window.screenY,
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = parseShortcut(e);
      if (!action) return;
      if (action === "new-project") {
        e.preventDefault();
        navigate("/new");
      } else if (action === "focus-search") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (action === "dismiss") {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <>
      <input
        ref={searchRef}
        type="search"
        className="sr-only"
        aria-label="Jump"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const q = e.currentTarget.value.trim();
            if (q) navigate(`/?q=${encodeURIComponent(q)}`);
          }
        }}
      />
      {children}
    </>
  );
}
