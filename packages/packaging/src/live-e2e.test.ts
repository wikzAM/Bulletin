import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startSidecar, type SidecarClient } from "./sidecar-client";

/*
 * Live end-to-end: the PACKAGED sidecar executable (not source) plans, runs and finishes a real mission against a
 * fresh clone of the demo repository, driven over stdio JSON-RPC exactly as the Tauri `rpc` command drives it.
 *
 * This spends real money (the Claude Code login on the machine pays for the General and the stations; about
 * $0.15 for the demo goal), so it runs only when BULLETIN_LIVE_E2E=1 and never as part of `pnpm run verify`.
 *
 *   $env:BULLETIN_LIVE_E2E = "1"; pnpm exec vitest run packages/packaging/src/live-e2e.test.ts
 *
 * Needs: `pnpm run sidecar:prepare` done (or BULLETIN_SIDECAR_EXE set), `claude` on PATH and logged in, and the demo
 * repository (BULLETIN_DEMO_REPO, default D:/bulletin-demo). No API key is read or needed.
 */

const live = process.env.BULLETIN_LIVE_E2E === "1" && process.platform === "win32";
const root = resolve(import.meta.dirname, "../../..");
const exe = process.env.BULLETIN_SIDECAR_EXE ?? join(root, "src-tauri", "binaries", "bulletin-sidecar-x86_64-pc-windows-msvc.exe");
const demo = process.env.BULLETIN_DEMO_REPO ?? "D:/bulletin-demo";
const GOAL = "Add a function add(a, b) to src/index.mjs that returns the sum of two numbers, and a node:test file src/add.test.mjs that tests it.";

vi.setConfig({ testTimeout: 20 * 60_000, hookTimeout: 120_000 });

describe.runIf(live)("packaged sidecar, live", () => {
  let work: string;
  let clone: string;
  let sidecar: SidecarClient;

  beforeAll(async () => {
    if (!existsSync(exe)) throw new Error(`no sidecar executable at ${exe}; run pnpm run sidecar:prepare`);
    if (!existsSync(join(demo, ".git"))) throw new Error(`no demo repository at ${demo}`);
    work = mkdtempSync(join(tmpdir(), "bulletin-live-"));
    clone = join(work, "demo");
    execFileSync("git", ["clone", "-q", demo, clone], { windowsHide: true });
    sidecar = await startSidecar(exe, [], {
      env: {
        ...process.env,
        BULLETIN_RESOURCE_DIR: root,
        BULLETIN_DATA_DIR: join(work, "data"),
        BULLETIN_RUNNER: "claude",
      },
    });
  });

  afterAll(async () => {
    await sidecar?.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  });

  it("creates, approves and finishes a mission whose integration branch passes node --test", async () => {
    expect(await sidecar.request("health")).toMatchObject({ status: "ok" });

    const created = (await sidecar.request("request", { method: "POST", path: "/missions", body: { goal: GOAL, repo: clone, budget_cents: 150 } }, 10 * 60_000)) as {
      status: number;
      body: { mission_id: string; plan: { units: unknown[] } };
    };
    expect(created.status).toBe(201);
    const id = created.body.mission_id;
    expect(created.body.plan.units.length).toBeGreaterThan(0);

    await sidecar.request("subscribe", { mission_id: id });
    const approved = (await sidecar.request("request", { method: "POST", path: `/missions/${id}/approve`, body: {} })) as { status: number };
    expect(approved.status).toBe(202);

    const finished = await sidecar.waitForEvent((e) => e.type === "mission.finished" && e.mission_id === id, 15 * 60_000);
    expect(finished.payload).toMatchObject({ failed: 0 });
    expect(Number(finished.payload?.shipped)).toBeGreaterThanOrEqual(1);
    process.stdout.write(`live e2e: mission ${id} finished, cost ${String(finished.payload?.cost_cents)} cents, ${sidecar.events.length} events\n`);

    // The merged work really passes the demo's own check.
    const checkout = join(work, "integration");
    execFileSync("git", ["worktree", "add", "-q", "--detach", checkout, `bulletin/${id}/integration`], { cwd: clone, windowsHide: true });
    const out = execFileSync("node", ["--test"], { cwd: checkout, encoding: "utf8", windowsHide: true });
    // Node prints "# pass N" with the tap reporter and "ℹ pass N" with the default one.
    expect(out).toMatch(/(?:#|ℹ) pass [1-9]/);
    expect(out).toMatch(/(?:#|ℹ) fail 0/);
  });
});
