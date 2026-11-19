export interface DiagnosticsInfo {
  appVersion: string;
  sidecarStatus: string;
  dataFolder: string;
}

/** Plain text for the copy-diagnostics button. Never include secrets. */
export function buildDiagnosticsText(info: DiagnosticsInfo): string {
  return [
    `Bulletin ${info.appVersion}`,
    `Sidecar: ${info.sidecarStatus}`,
    `Data folder: ${info.dataFolder}`,
  ].join("\n");
}

/**
 * What the About page shows. The sidecar's health and its data folder are asked separately, so a sidecar that
 * answers `health` is never reported "unreachable" because of the folder lookup.
 */
export async function loadDiagnostics(opts: {
  appVersion: string;
  kind: "tauri" | "http";
  invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<DiagnosticsInfo> {
  if (opts.kind !== "tauri" || !opts.invoke) {
    return { appVersion: opts.appVersion, sidecarStatus: "mock (browser)", dataFolder: "(browser)" };
  }
  const { invoke } = opts;
  let sidecarStatus: string;
  try {
    const health = (await invoke("rpc", { method: "health", params: {} })) as { status?: string } | null;
    sidecarStatus = health?.status ?? "ok";
  } catch {
    return { appVersion: opts.appVersion, sidecarStatus: "unreachable", dataFolder: "(unknown)" };
  }
  let dataFolder = "(unknown)";
  try {
    const info = (await invoke("rpc", { method: "app.info", params: {} })) as { data_folder?: unknown } | null;
    if (typeof info?.data_folder === "string" && info.data_folder) dataFolder = info.data_folder;
  } catch {
    // keep "(unknown)"
  }
  return { appVersion: opts.appVersion, sidecarStatus, dataFolder };
}
