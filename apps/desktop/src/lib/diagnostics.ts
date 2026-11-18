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
