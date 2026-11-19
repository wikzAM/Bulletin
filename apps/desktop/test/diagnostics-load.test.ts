import { describe, expect, it } from "vitest";
import { loadDiagnostics } from "../src/lib/diagnostics";

const base = { appVersion: "0.1.0", kind: "tauri" as const };

describe("loadDiagnostics", () => {
  it("reports the sidecar's status and data folder when both answer", async () => {
    const invoke = async (_cmd: string, args: Record<string, unknown>) =>
      args.method === "health" ? { status: "ok" } : { data_folder: "C:/Users/me/AppData/Local/Bulletin" };
    expect(await loadDiagnostics({ ...base, invoke })).toEqual({
      appVersion: "0.1.0",
      sidecarStatus: "ok",
      dataFolder: "C:/Users/me/AppData/Local/Bulletin",
    });
  });

  it("a healthy sidecar is not 'unreachable' just because the data folder could not be read", async () => {
    const invoke = async (_cmd: string, args: Record<string, unknown>) => {
      if (args.method === "health") return { status: "ok" };
      throw { code: -32601, message: "Method not found" };
    };
    const info = await loadDiagnostics({ ...base, invoke });
    expect(info.sidecarStatus).toBe("ok");
    expect(info.dataFolder).toBe("(unknown)");
  });

  it("says unreachable when health fails", async () => {
    const invoke = async () => {
      throw { code: -32000, message: "Sidecar unavailable" };
    };
    expect((await loadDiagnostics({ ...base, invoke })).sidecarStatus).toBe("unreachable");
  });

  it("in a browser there is no sidecar to ask", async () => {
    const info = await loadDiagnostics({ appVersion: "0.1.0", kind: "http" });
    expect(info).toEqual({ appVersion: "0.1.0", sidecarStatus: "mock (browser)", dataFolder: "(browser)" });
  });
});
