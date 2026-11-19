import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { EnvKeychain } from "./keychain";
import { macosKeychain } from "./macos";
import { appDataDirectory } from "./paths";
import { spawnCommand, systemShell } from "./process";
import { windowsKeychain } from "./windows";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

it("resolves app data locations for each platform and honors an override", () => {
  expect(appDataDirectory({ LOCALAPPDATA: "C:\\AppData" }, "win32", "C:\\Users\\alex")).toBe("C:\\AppData\\Bulletin");
  expect(appDataDirectory({}, "win32", "C:\\Users\\alex")).toBe("C:\\Users\\alex\\AppData\\Local\\Bulletin");
  expect(appDataDirectory({}, "darwin", "/Users/alex")).toBe("/Users/alex/Library/Application Support/Bulletin");
  expect(appDataDirectory({ XDG_DATA_HOME: "/data" }, "linux", "/home/alex")).toBe("/data/Bulletin");
  expect(appDataDirectory({ XDG_DATA_HOME: "relative" }, "linux", "/home/alex")).toBe("/home/alex/.local/share/Bulletin");
  expect(appDataDirectory({ BULLETIN_DATA_DIR: "/custom" }, "linux", "/home/alex")).toBe("/custom");
});

it("passes executable arguments unchanged and runs an explicit script with the platform shell", async () => {
  expect(systemShell("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" })).toBe("C:\\Windows\\System32\\cmd.exe");
  expect(systemShell("linux", {})).toBe("/bin/sh");

  const arg = "words & symbols; %PATH%";
  const child = spawnCommand({ executable: process.execPath, args: ["-p", "process.argv[1]", arg] }, { cwd: process.cwd() });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  expect(await once(child, "close")).toEqual([0, null]);
  expect(output.trim()).toBe(arg);

  const shell = spawnCommand({ script: "echo bulletin-shell" }, { cwd: process.cwd() });
  let shellOutput = "";
  shell.stdout.setEncoding("utf8").on("data", (chunk: string) => { shellOutput += chunk; });
  expect(await once(shell, "close")).toEqual([0, null]);
  expect(shellOutput.trim()).toBe("bulletin-shell");
});

it("reads and writes env secrets and reports unavailable TypeScript native stores", async () => {
  const env = { EXISTING: "original" };
  const keychain = new EnvKeychain(env);
  expect(await keychain.getSecret("EXISTING")).toBe("original");
  expect(await keychain.getSecret("MISSING")).toBeUndefined();
  await keychain.setSecret("NEW_SECRET", "configured");
  expect(env).toHaveProperty("NEW_SECRET", "configured");
  await expect(keychain.setSecret("invalid=name", "value")).rejects.toThrow(/name/i);
  await expect(windowsKeychain.getSecret("NEW_SECRET")).rejects.toThrow(/Windows.*keychain/i);
  await expect(macosKeychain.setSecret("NEW_SECRET", "value")).rejects.toThrow(/macOS.*keychain/i);
});
