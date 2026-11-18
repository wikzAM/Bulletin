import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { JsonlEventLog } from "./jsonl-event-log";

async function listFromBoot(directory: string) {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../serve.ts", import.meta.url))], {
    env: { ...process.env, PORT: "0", BULLETIN_SCRATCH_DIR: directory, BULLETIN_RUNNER: "claude" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = once(child, "close");
  let output = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  const timeout = setTimeout(() => child.kill(), 60_000);
  try {
    let address: string | undefined;
    for await (const line of createInterface({ input: child.stdout })) {
      address = /^api listening on (http:\/\/127\.0\.0\.1:[1-9]\d*)$/.exec(line)?.[1];
      if (address) break;
      output += `${line}\n`;
    }
    if (!address) throw new Error(`API did not start: ${output}`);

    const response = await fetch(`${address}/missions`, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(200);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    child.kill();
    await exited;
  }
}

it("boots on an assigned port and durably marks unfinished missions interrupted once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-api-"));
  const apiData = join(directory, "api");
  const path = join(apiData, "events.jsonl");
  try {
    const log = await JsonlEventLog.open(path);
    try {
      await log.emit({ mission_id: "restored", type: "mission.created", payload: { repo: "/repos/demo", base: "main" } });
      await log.emit({ mission_id: "restored", type: "plan.approved" });
      await log.emit({ mission_id: "planned", type: "mission.created" });
      await log.emit({ mission_id: "planned", type: "plan.proposed" });
      await log.emit({ mission_id: "complete", type: "mission.created" });
      await log.emit({ mission_id: "complete", type: "mission.finished" });
      await log.emit({ mission_id: "orphan", type: "unit.started" });
    } finally {
      await log.close();
    }

    const missions = await listFromBoot(directory);
    expect(missions).toEqual({ missions: [
      { id: "restored", status: "interrupted", repo: "/repos/demo", base: "main", created_at: expect.any(String) },
      { id: "planned", status: "interrupted", repo: null, base: null, created_at: expect.any(String) },
      { id: "complete", status: "finished", repo: null, base: null, created_at: expect.any(String) },
    ] });
    expect(await listFromBoot(directory)).toEqual(missions);

    const recovered = await JsonlEventLog.open(path);
    try {
      expect(recovered.events.filter(({ type }) => type === "mission.finished").map(({ mission_id, payload }) => ({ mission_id, payload })))
        .toEqual([
          { mission_id: "complete", payload: {} },
          { mission_id: "restored", payload: { interrupted: true } },
          { mission_id: "planned", payload: { interrupted: true } },
        ]);
    } finally {
      await recovered.close();
    }
  } finally {
    await rm(path, { force: true });
    await rm(join(apiData, "briefings.jsonl"), { force: true });
    await rmdir(apiData);
    await rmdir(directory);
  }
}, 125_000);

it("warns about missing managed environment variable names without printing configured values", () => {
  const entry = fileURLToPath(new URL("../serve.ts", import.meta.url));
  const configuredValue = "fake-managed-key-for-startup-test";
  const result = spawnSync(process.execPath, ["--import", "tsx", entry], {
    env: {
      ...process.env, PORT: "0", BULLETIN_RUNNER: "managed", BULLETIN_SANDBOX_REPO: "",
      ANTHROPIC_API_KEY: configuredValue, BULLETIN_GITHUB_TOKEN: "",
      BULLETIN_MA_AGENT_ID: "configured", BULLETIN_MA_ENV_ID: "configured",
    },
    encoding: "utf8", timeout: 60_000, windowsHide: true,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Managed runner is missing environment variables: BULLETIN_SANDBOX_REPO, BULLETIN_GITHUB_TOKEN");
  expect(`${result.stdout}${result.stderr}`).not.toContain(configuredValue);
}, 65_000);
