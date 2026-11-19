import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { startSidecar, type SidecarClient } from "../../../packages/packaging/src/sidecar-client";
import { git } from "../../../packages/runners/src/git";

vi.setConfig({ testTimeout: 180_000 });

it.each(["attempt", "merge"])("resumes a killed run at %s without running or charging merged work again", async (crashAt) => {
  const prefix = resolve(tmpdir(), "bulletin-crash-");
  const directory = await mkdtemp(prefix);
  if (!resolve(directory).startsWith(prefix)) throw new Error("Fixture directory is outside its expected path");
  const repo = join(directory, "repo");
  const entry = fileURLToPath(new URL("test-fixtures/crash-resume.ts", import.meta.url));
  let sidecar: SidecarClient | undefined;

  function boot(mode: string) {
    return startSidecar(process.execPath, ["--import", "tsx", entry, mode], {
      env: { ...process.env, BULLETIN_DATA_DIR: join(directory, "data"), BULLETIN_SCRATCH_DIR: directory,
        BULLETIN_EVENT_STORE: "sqlite", BULLETIN_PROVIDER: "", BULLETIN_RUNNER: "claude", BULLETIN_API_TOKEN: "" },
    });
  }

  async function request<Body>(method: string, path: string, status: number, body?: object): Promise<Body> {
    const reply = await sidecar!.request("request", { method, path, body }) as { status: number; body: Body };
    expect(reply.status, `${method} ${path} ${JSON.stringify(reply.body)}`).toBe(status);
    return reply.body;
  }

  try {
    await mkdir(repo);
    await git(repo, "init", "-q", "-b", "main");
    await git(repo, "config", "user.name", "Fixture");
    await git(repo, "config", "user.email", "fixture@example.invalid");
    await git(repo, "config", "commit.gpgsign", "false");
    await Promise.all(["first.txt", "second.txt"].map((name) => writeFile(join(repo, name), "0\n")));
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "fixture base");

    sidecar = await boot(crashAt);
    const { mission_id } = await request<{ mission_id: string }>("POST", "/missions", 201, {
      goal: "Set both values", repo, budget_cents: 50,
    });
    const mission = `/missions/${mission_id}`;
    const branch = `bulletin/${mission_id}/integration`;
    await request("POST", `${mission}/approve`, 202);
    await vi.waitFor(() => access(join(directory, "crash-ready")), { timeout: 60_000, interval: 100 });
    process.kill(sidecar.pid!, "SIGKILL");
    expect(await sidecar.close()).not.toBe(0);
    expect(await git(repo, "show", `${branch}:first.txt`)).toBe("1");

    sidecar = await boot("resume");
    expect(await request("GET", mission, 200)).toMatchObject({ status: "interrupted" });
    const url = `${mission}/resume`;
    expect(await request("POST", url, 202)).toEqual({ mission_id, status: "running" });
    await sidecar.request("subscribe", { mission_id });
    await sidecar.waitForEvent((event) => event.type === "mission.finished", 60_000);
    expect(await request("GET", `${mission}/report`, 200)).toMatchObject({
      shipped: ["first", "second"], model_calls: 2,
    });
    expect(sidecar.events.filter(({ type }) => type === "mission.interrupted")).toHaveLength(1);
    expect(sidecar.events.filter(({ type, unit_id }) => type === "ledger.charged" && unit_id === "first")).toHaveLength(1);
    const attempts = sidecar.events
      .filter(({ type, unit_id }) => type === "attempt.started" && unit_id === "second")
      .map(({ payload }) => payload?.attempt);
    expect(attempts).toEqual(crashAt === "attempt" ? [1, 2] : [1]);
    expect(await request("POST", url, 409)).toEqual({ error: "Mission is not interrupted" });
    expect(await git(repo, "show", `${branch}:second.txt`)).toBe("1");
    expect(await git(repo, "show", "main:first.txt")).toBe("0");
    expect(await sidecar.close()).toBe(0);
  } finally {
    if (sidecar?.pid !== undefined) {
      try { process.kill(sidecar.pid); } catch { /* the fixture already exited */ }
      await sidecar.close();
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
