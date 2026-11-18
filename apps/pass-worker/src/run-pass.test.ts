import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "@bulletin/core";
import { runCommand, runPass } from "./run-pass";

// Real git and child processes; the default 5s is too tight on a loaded Windows machine.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

let root: string;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bulletin-pass-"));
});
afterEach(() => {
  // Whatever the kill did, do not leave hung processes behind: process.kill needs no WMI.
  for (const name of ["hang.pid", "grandchild.pid"]) {
    try {
      process.kill(Number(readFileSync(join(root, name), "utf8")), "SIGKILL");
    } catch {
      /* never written, or already dead */
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

/** Where the hanging scripts record their pids, outside any worktree, so cleanup can kill them without WMI. */
const pidFile = (name: string) => join(root, name).split("\\").join("/");

/** A check that starts a grandchild, records both pids, and then hangs forever itself. */
const hang = () => `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile("hang.pid"))}, String(process.pid));
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile("grandchild.pid"))}, String(child.pid));
console.log("started");
setInterval(() => {}, 1000);
`;

/** A check that just hangs. */
const hangSimple = () => `
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile("hang.pid"))}, String(process.pid));
console.log("started");
setInterval(() => {}, 1000);
`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitUntilDead(pid: number, ms = 15_000) {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return !alive(pid);
}

describe("runCommand", () => {
  it("kills a hanging check and everything it started, then reports a timeout", async () => {
    writeFileSync(join(root, "hang.mjs"), hang());
    const started = Date.now();
    const result = await runCommand("test", "node hang.mjs", root, 10_000);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain("timed out");
    expect(result.output).toContain("started");

    expect(existsSync(join(root, "grandchild.pid"))).toBe(true);
    const grandchild = Number(readFileSync(join(root, "grandchild.pid"), "utf8"));
    expect(await waitUntilDead(grandchild)).toBe(true);
  });

  it("does not report a timeout for a command that finishes in time", async () => {
    writeFileSync(join(root, "ok.mjs"), 'console.log("fine");');
    const result = await runCommand("test", "node ok.mjs", root, 30_000);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.output).toContain("fine");
    expect(result.output).not.toContain("timed out");
  });

  it("still refuses commands with shell characters", async () => {
    const result = await runCommand("test", "node ok.mjs && echo hi", root);
    expect(result.exitCode).toBe(126);
  });
});

describe("runPass", () => {
  it("returns RED for a check that hangs, in a clean worktree that is cleaned up", async () => {
    const repo = join(root, "repo");
    const scratch = join(root, "scratch");
    mkdirSync(repo);
    sh(repo, "init", "-q", "-b", "main");
    sh(repo, "config", "user.name", "test");
    sh(repo, "config", "user.email", "test@example.com");
    writeFileSync(join(repo, "hang.mjs"), hangSimple());
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src/a.ts"), "export const a = 0;\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "base");
    sh(repo, "branch", "integ");
    sh(repo, "checkout", "-q", "-b", "unit");
    writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n");
    sh(repo, "commit", "-qam", "unit");
    sh(repo, "checkout", "-q", "main");

    const unit = { id: "u1", title: "t", task: "t", files: ["src/a.ts"], acceptance: [], needs: [], lane: "open", tier: "station" } as unknown as Unit;
    const started = Date.now();
    const verdict = await runPass({
      repo,
      scratchDir: scratch,
      unit,
      unitBranch: "unit",
      integrationBranch: "integ",
      testCommand: "node hang.mjs",
      commandTimeoutMs: 3000,
    });
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(verdict.verdict).toBe("red");
    expect(verdict.evidence).toContain("timed out");
    expect(sh(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });
});
