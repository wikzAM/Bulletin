export interface SidecarBuildOptions {
  /** Repository root. Defaults to the folder above scripts/. */
  root?: string;
  /** Where the result is written. Defaults to src-tauri/binaries under the root. */
  outDir?: string;
  /** Scratch folder for the bundle and the SEA blob. Defaults to a folder under the system temp directory. */
  workDir?: string;
}
export function targetTriple(platform?: string, arch?: string): string;
export function sidecarFileName(triple?: string): string;
export function seaConfig(paths: { main: string; blob: string }): {
  main: string;
  output: string;
  disableExperimentalSEAWarning: boolean;
  useCodeCache: boolean;
  useSnapshot: boolean;
};
export function bundleSidecar(options: { root?: string; outFile: string }): Promise<{ outFile: string; bytes: number }>;
export function buildSidecar(options?: SidecarBuildOptions): Promise<{ executable: string; bundle: string; bytes: number }>;
