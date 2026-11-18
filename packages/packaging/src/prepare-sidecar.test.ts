import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRustcTriple, prepareSidecar } from "../../../scripts/prepare-sidecar.mjs";

const RUSTC_VV = [
  "rustc 1.90.0 (1159e78c4 2025-09-14)",
  "binary: rustc",
  "commit-hash: 1159e78c4747b02ef996e55082b704c09b970588",
  "host: x86_64-pc-windows-msvc",
  "release: 1.90.0",
  "LLVM version: 20.1.8",
].join("\n");

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bulletin-prepare-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

/** A build that just writes the file buildSidecar would: no 90 MB copy of node in a unit test. */
const fakeBuild = async ({ outDir }: { root: string; outDir: string }) => {
  mkdirSync(outDir, { recursive: true });
  const executable = join(outDir, "bulletin-sidecar-x86_64-pc-windows-msvc.exe");
  writeFileSync(executable, "binary");
  return { executable };
};

describe("parseRustcTriple", () => {
  it("reads the host line of rustc -vV", () => {
    expect(parseRustcTriple(RUSTC_VV)).toBe("x86_64-pc-windows-msvc");
  });
  it("tolerates Windows line endings", () => {
    expect(parseRustcTriple(RUSTC_VV.replaceAll("\n", "\r\n"))).toBe("x86_64-pc-windows-msvc");
  });
  it("fails clearly when there is no host line", () => {
    expect(() => parseRustcTriple("rustc 1.90.0")).toThrow(/host/);
  });
});

describe("prepareSidecar", () => {
  it("builds into src-tauri/binaries under the name Tauri's externalBin needs for rustc's triple", async () => {
    const out = await prepareSidecar({ root, rustcVV: RUSTC_VV, build: fakeBuild });
    expect(out.triple).toBe("x86_64-pc-windows-msvc");
    expect(out.executable).toBe(join(root, "src-tauri", "binaries", "bulletin-sidecar-x86_64-pc-windows-msvc.exe"));
    expect(existsSync(out.executable)).toBe(true);
  });

  it("uses the target triple Tauri passes when it differs from the host's", async () => {
    await expect(prepareSidecar({ root, rustcVV: RUSTC_VV, target: "aarch64-pc-windows-msvc", build: fakeBuild })).rejects.toThrow(/aarch64-pc-windows-msvc/);
  });

  it("refuses a triple it cannot build for, without building anything", async () => {
    let built = false;
    const rustcVV = RUSTC_VV.replace("x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu");
    await expect(
      prepareSidecar({ root, rustcVV, build: async (o) => ((built = true), fakeBuild(o)) }),
    ).rejects.toThrow(/x86_64-unknown-linux-gnu/);
    expect(built).toBe(false);
  });

  it("fails if the build did not leave the expected file", async () => {
    await expect(prepareSidecar({ root, rustcVV: RUSTC_VV, build: async () => ({ executable: join(root, "nowhere.exe") }) })).rejects.toThrow(/expected/i);
  });
});
