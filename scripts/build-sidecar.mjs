// Bundle apps/sidecar into one Windows executable (see docs/PACKAGING.md).
//
//   node scripts/build-sidecar.mjs [--out-dir <dir>] [--work-dir <dir>]
//
// Steps: esbuild turns the sidecar and everything it imports into one CommonJS file; Node's single
// executable support (`node --experimental-sea-config`) turns that file into a blob; postject copies
// the blob into a copy of node.exe. The result is named the way Tauri's `externalBin` needs:
// bulletin-sidecar-x86_64-pc-windows-msvc.exe.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { inject } from "postject";

/** The sentinel Node looks for to know a single-executable blob was injected. Fixed by Node, not by us. */
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const TRIPLES = { "win32-x64": "x86_64-pc-windows-msvc" };

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Rust-style target triple for a platform, as Tauri names external binaries. Only Windows x64 ships for now. */
export function targetTriple(platform = process.platform, arch = process.arch) {
  const triple = TRIPLES[`${platform}-${arch}`];
  if (!triple) throw new Error(`Building the sidecar is not supported on ${platform}/${arch} yet (only win32/x64).`);
  return triple;
}

export function sidecarFileName(triple = targetTriple()) {
  return `bulletin-sidecar-${triple}${triple.includes("windows") ? ".exe" : ""}`;
}

/** The config file `node --experimental-sea-config` reads. */
export function seaConfig({ main, blob }) {
  return { main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false };
}

/**
 * Bundle the sidecar into one CommonJS file (a single executable's main script cannot be an ES module).
 * Workspace packages, fastify, zod and the Anthropic SDK are all bundled; only Node's own modules stay
 * external. `import.meta` does not exist in CommonJS, so the two places the code reads it are pointed at
 * the executable's own folder: the packaged app sets BULLETIN_RESOURCE_DIR, which wins over both.
 */
export async function bundleSidecar({ root = defaultRoot, outFile }) {
  const result = await build({
    entryPoints: [join(root, "apps/sidecar/src/main.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    banner: {
      js: 'const __bulletinExeUrl = require("node:url").pathToFileURL(process.execPath).href; const __bulletinExeDir = require("node:path").dirname(process.execPath);',
    },
    define: {
      "import.meta.url": "__bulletinExeUrl",
      "import.meta.dirname": "__bulletinExeDir",
    },
  });
  // A warning here means something in the bundle will not behave as written. Fail the build, do not ship it.
  if (result.warnings.length > 0) {
    throw new Error(`esbuild warnings:\n${result.warnings.map((w) => `${w.location?.file ?? ""}:${w.location?.line ?? ""} ${w.text}`).join("\n")}`);
  }
  return { outFile, bytes: statSync(outFile).size };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}):\n${result.stdout}${result.stderr}`);
}

/** Build the whole thing. Returns where the executable is. */
export async function buildSidecar({ root = defaultRoot, outDir = join(root, "src-tauri/binaries"), workDir } = {}) {
  const triple = targetTriple();
  const work = workDir ?? mkdtempSync(join(tmpdir(), "bulletin-sidecar-"));
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const bundle = join(work, "sidecar.cjs");
  const blob = join(work, "sidecar.blob");
  const configFile = join(work, "sea-config.json");
  const { bytes } = await bundleSidecar({ root, outFile: bundle });

  writeFileSync(configFile, JSON.stringify(seaConfig({ main: bundle, blob }), null, 2));
  run(process.execPath, ["--experimental-sea-config", configFile], work);

  // The blob only fits the node that made it, so the executable is a copy of this same node.
  const executable = join(outDir, sidecarFileName(triple));
  rmSync(executable, { force: true });
  copyFileSync(process.execPath, executable);
  await inject(executable, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: SEA_FUSE });
  return { executable, bundle, bytes };
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = option("--out-dir");
  const workDir = option("--work-dir");
  buildSidecar({ outDir: outDir && resolve(outDir), workDir: workDir && resolve(workDir) })
    .then(({ executable, bytes }) => {
      process.stdout.write(`Built ${executable} (bundle ${(bytes / 1024 / 1024).toFixed(1)} MB)\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
