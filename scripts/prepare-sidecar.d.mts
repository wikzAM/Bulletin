export function parseRustcTriple(rustcVV: string): string;
export function prepareSidecar(options?: {
  root?: string;
  /** Output of `rustc -vV`. Default: run rustc. */
  rustcVV?: string;
  /** Triple to build for instead of rustc's host triple (Tauri sets TAURI_ENV_TARGET_TRIPLE). */
  target?: string;
  /** Builds the executable into outDir. Default: buildSidecar from build-sidecar.mjs. */
  build?: (options: { root: string; outDir: string }) => Promise<{ executable: string }>;
}): Promise<{ triple: string; executable: string }>;
