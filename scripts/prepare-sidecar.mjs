// Prepare the sidecar for the Tauri build (see docs/PACKAGING.md):
//
//   pnpm run sidecar:prepare            (node scripts/prepare-sidecar.mjs [--target <triple>])
//
// Builds the single-executable sidecar and leaves it at src-tauri/binaries/bulletin-sidecar-<target triple>.exe,
// the name Tauri's `bundle.externalBin: ["binaries/bulletin-sidecar"]` looks for. The triple comes from
// `rustc -vV` (the host), or from --target / TAURI_ENV_TARGET_TRIPLE when Tauri cross-builds.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSidecar, sidecarFileName, targetTriple } from "./build-sidecar.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The `host:` line of `rustc -vV`. */
export function parseRustcTriple(rustcVV) {
  const match = /^host:\s*(\S+)\s*$/m.exec(rustcVV.replaceAll("\r\n", "\n"));
  if (!match) throw new Error("rustc -vV printed no host line; is Rust installed?");
  return match[1];
}

export async function prepareSidecar({ root = defaultRoot, rustcVV, target, build = buildSidecar } = {}) {
  const triple = target ?? parseRustcTriple(rustcVV ?? execFileSync("rustc", ["-vV"], { encoding: "utf8", windowsHide: true }));
  // buildSidecar only knows how to make the Windows x64 executable; say so before spending a minute building.
  const supported = targetTriple("win32", "x64");
  if (triple !== supported) throw new Error(`The sidecar can only be built for ${supported} so far, not ${triple}.`);

  const outDir = join(root, "src-tauri", "binaries");
  await build({ root, outDir });
  const executable = join(outDir, sidecarFileName(triple));
  if (!existsSync(executable)) throw new Error(`Build finished but the expected file is missing: ${executable}`);
  return { triple, executable };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const at = process.argv.indexOf("--target");
  const target = (at >= 0 ? process.argv[at + 1] : undefined) ?? process.env.TAURI_ENV_TARGET_TRIPLE;
  prepareSidecar({ target })
    .then(({ triple, executable }) => process.stdout.write(`Prepared ${executable} for ${triple}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
