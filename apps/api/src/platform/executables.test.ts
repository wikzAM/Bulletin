import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolveExecutable, runTool } from "./executables";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bulletin-exe-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

/** A tiny program the platform can run by name: a .cmd shim on Windows, a shell script elsewhere. */
async function fakeTool(name: string, body: { win: string; posix: string }): Promise<string> {
  if (process.platform === "win32") {
    const path = join(directory, `${name}.cmd`);
    await writeFile(path, `@echo off\r\n${body.win}\r\n`);
    return path;
  }
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${body.posix}\n`);
  await chmod(path, 0o755);
  return path;
}

it("finds a program on PATH, honoring PATHEXT on Windows and skipping folders and missing names", async () => {
  expect(resolveExecutable("tool", { PATH: directory }, "win32")).toBeUndefined();
  await writeFile(join(directory, "tool.cmd"), "@echo off\r\n");
  await mkdir(join(directory, "folder.exe"));
  expect(resolveExecutable("tool", { PATH: directory, PATHEXT: ".EXE;.CMD" }, "win32")?.toLowerCase()).toBe(join(directory, "tool.cmd").toLowerCase());
  expect(resolveExecutable("tool.cmd", { Path: directory, PATHEXT: ".EXE;.CMD" }, "win32")?.toLowerCase()).toBe(join(directory, "tool.cmd").toLowerCase());
  expect(resolveExecutable("tool", { PATH: directory, PATHEXT: ".EXE" }, "win32")).toBeUndefined();
  expect(resolveExecutable("folder", { PATH: directory, PATHEXT: ".EXE" }, "win32")).toBeUndefined();
  expect(resolveExecutable("tool", { PATH: "" }, "win32")).toBeUndefined();
  expect(resolveExecutable("../tool", { PATH: directory }, "win32")).toBeUndefined();
});

// Windows has no execute bit, so this can only be exercised where the file system has one.
it.skipIf(process.platform === "win32")("on Unix a program must be executable and the name is exact", async () => {
  await writeFile(join(directory, "plain"), "#!/bin/sh\n");
  await writeFile(join(directory, "runnable"), "#!/bin/sh\n");
  await chmod(join(directory, "runnable"), 0o755);
  expect(resolveExecutable("runnable", { PATH: directory }, "linux")).toBe(join(directory, "runnable"));
  expect(resolveExecutable("plain", { PATH: directory }, "linux")).toBeUndefined();
});

it("runs a program with literal arguments (including a Windows .cmd shim) and captures its output and exit code", async () => {
  const tool = await fakeTool("echoer", { win: "echo out-%1-%2\r\nexit /b 3", posix: 'echo "out-$1-$2"; exit 3' });
  const result = await runTool(tool, ["alpha", "beta"], { cwd: directory, env: process.env, timeoutMs: 20_000 });
  expect(result).toMatchObject({ code: 3, timedOut: false, truncated: false });
  expect(result.stdout.trim()).toBe("out-alpha-beta");
});

it("refuses arguments it cannot pass to a shim safely", async () => {
  const tool = await fakeTool("echoer", { win: "echo hi", posix: "echo hi" });
  if (process.platform === "win32") {
    await expect(runTool(tool, ["a&b"], { cwd: directory, env: process.env, timeoutMs: 5_000 })).rejects.toThrow(/argument/i);
  }
});

it("stops a program that runs past its time limit and reports it", async () => {
  const hang = join(directory, "hang.mjs");
  await writeFile(hang, "setInterval(() => {}, 1000);");
  const result = await runTool(process.execPath, [hang], { cwd: directory, env: process.env, timeoutMs: 400 });
  expect(result.timedOut).toBe(true);
  expect(result.code).not.toBe(0);
});

it("caps captured output and says so", async () => {
  const noisy = join(directory, "noisy.mjs");
  await writeFile(noisy, 'process.stdout.write("x".repeat(100000));');
  const result = await runTool(process.execPath, [noisy], { cwd: directory, env: process.env, timeoutMs: 20_000, maxBytes: 1000 });
  expect(result.truncated).toBe(true);
  expect(result.stdout.length).toBeLessThanOrEqual(1000);
});

it("reports a program that cannot start", async () => {
  const result = await runTool(join(directory, "nothing.exe"), [], { cwd: directory, env: process.env, timeoutMs: 5_000 });
  expect(result.code).toBeNull();
});
