import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { JsonlEventLog } from "./jsonl-event-log";

it("boots the API on an assigned port and serves missions from disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-api-"));
  const apiData = join(directory, "api");
  const path = join(apiData, "events.jsonl");
  try {
    const log = await JsonlEventLog.open(path);
    try {
      await log.emit({ mission_id: "restored", type: "mission.created", payload: { repo: "/repos/demo", base: "main" } });
    } finally {
      await log.close();
    }

    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../serve.ts", import.meta.url))], {
      env: { ...process.env, PORT: "0", BULLETIN_SCRATCH_DIR: directory },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const exited = once(child, "close");
    let output = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
    const timeout = setTimeout(() => child.kill(), 5000);
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
      expect(await response.json()).toEqual({ missions: [
        { id: "restored", status: "interview", repo: "/repos/demo", base: "main", created_at: expect.any(String) },
      ] });
    } finally {
      clearTimeout(timeout);
      child.kill();
      await exited;
    }
  } finally {
    await rm(path, { force: true });
    await rmdir(apiData);
    await rmdir(directory);
  }
}, 8000);
