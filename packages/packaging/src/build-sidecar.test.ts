import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSidecar, bundleSidecar, seaConfig, sidecarFileName, targetTriple } from "../../../scripts/build-sidecar.mjs";

// Real bundling and a real executable; the default 5s is far too short on a loaded Windows machine.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });

const root = resolve(import.meta.dirname, "../../..");
let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "bulletin-sidecar-build-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

/** Start a program, send it one JSON-RPC line, collect the first reply line, then close stdin and wait for it to exit. */
function ask(command: string, args: string[], request: object): Promise<{ reply: unknown; exitCode: number | null; stderr: string }> {
  return new Promise((resolveAsk, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, BULLETIN_RESOURCE_DIR: root, BULLETIN_DATA_DIR: join(work, "data") },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let stderr = "";
    let reply: unknown;
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.stdout.on("data", (d) => {
      out += String(d);
      const newline = out.indexOf("\n");
      if (reply === undefined && newline >= 0) {
        reply = JSON.parse(out.slice(0, newline));
        child.stdin.end();
      }
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolveAsk({ reply, exitCode, stderr }));
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

const health = { jsonrpc: "2.0", id: 1, method: "health" };

describe("names", () => {
  it("names the Windows executable the way Tauri's external binary convention needs", () => {
    expect(targetTriple("win32", "x64")).toBe("x86_64-pc-windows-msvc");
    expect(sidecarFileName(targetTriple("win32", "x64"))).toBe("bulletin-sidecar-x86_64-pc-windows-msvc.exe");
  });

  it("refuses a platform it has no triple for, instead of guessing", () => {
    expect(() => targetTriple("linux", "x64")).toThrow(/not supported/i);
  });

  it("writes a SEA config that stays quiet and uses no snapshot", () => {
    expect(seaConfig({ main: "a.cjs", blob: "a.blob" })).toEqual({
      main: "a.cjs",
      output: "a.blob",
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    });
  });
});

describe("bundleSidecar", () => {
  it("produces one self-contained file that answers health with plain node, from outside the repo", async () => {
    const outFile = join(work, "sidecar.cjs");
    const result = await bundleSidecar({ root, outFile });
    expect(result.outFile).toBe(outFile);
    expect(statSync(outFile).size).toBeGreaterThan(100_000);
    // Self-contained: nothing in it may load a workspace package or node_modules at run time.
    const text = readFileSync(outFile, "utf8");
    expect(text).not.toMatch(/require\(["'](?:@bulletin|fastify|zod)/);

    const { reply, exitCode } = await ask(process.execPath, [outFile], health);
    expect(reply).toMatchObject({ jsonrpc: "2.0", id: 1, result: { status: "ok", service: "api" } });
    expect(exitCode).toBe(0);
  });
});

// Builds a ~90 MB executable (30-100 s on this machine), which would slow `pnpm run verify` for every station and
// graph run. The release workflow sets BULLETIN_SIDECAR_EXE_TEST=1; set it by hand before changing the build.
const exeTest = process.platform === "win32" && process.arch === "x64" && process.env.BULLETIN_SIDECAR_EXE_TEST === "1";
describe.runIf(exeTest)("buildSidecar", () => {
  it("builds the single executable, which answers health and exits when stdin closes", async () => {
    const outDir = join(work, "binaries");
    const built = await buildSidecar({ root, outDir, workDir: join(work, "scratch") });
    expect(built.executable).toBe(join(outDir, "bulletin-sidecar-x86_64-pc-windows-msvc.exe"));
    expect(existsSync(built.executable)).toBe(true);

    // Run it from a different folder with no node_modules anywhere near it.
    const { reply, exitCode, stderr } = await ask(built.executable, [], health);
    expect(stderr).not.toMatch(/cannot find module|ERR_/i);
    expect(reply).toMatchObject({ jsonrpc: "2.0", id: 1, result: { status: "ok", service: "api" } });
    expect(exitCode).toBe(0);
  });
});
