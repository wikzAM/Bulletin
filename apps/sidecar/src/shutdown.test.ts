import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { SqliteEventLog } from "../../api/src/store/sqlite-event-log";

vi.setConfig({ testTimeout: 60_000 });

interface Frame {
  id?: number;
  result?: { status?: number | string };
  params?: { event: { type: string } };
}

it.each([
  { mode: "stdin EOF", rpc: false, hangs: false },
  { mode: "shutdown RPC", rpc: true, hangs: false },
  { mode: "shutdown RPC with an unresponsive runner", rpc: true, hangs: true },
])("aborts missions, persists their events, and exits within five seconds on $mode", async ({ rpc, hangs }) => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-shutdown-"));
  const fixture = fileURLToPath(new URL("test-fixtures/shutdown.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", fixture, ...(hangs ? ["hang"] : [])], {
    env: { ...process.env, BULLETIN_DATA_DIR: directory, BULLETIN_API_TOKEN: "" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = once(child, "close");
  const startupLimit = setTimeout(() => child.kill(), 30_000).unref();
  const output = createInterface({ input: child.stdout });
  const frames = output[Symbol.asyncIterator]();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.on("error", () => {});
  let shutdownLimit: NodeJS.Timeout | undefined;

  function send(id: number, method: string, params?: object) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  }

  async function receive(): Promise<Frame> {
    const line = await frames.next();
    if (line.done) throw new Error(`Sidecar stopped before sending a frame. ${stderr}`);
    return JSON.parse(line.value) as Frame;
  }

  try {
    send(1, "subscribe", { mission_id: "demo" });
    expect(await receive()).toMatchObject({ id: 1, result: { subscription_id: 1 } });
    send(2, "request", { method: "POST", path: "/missions/demo/approve" });
    let approved = false;
    let running = false;
    while (!approved || !running) {
      const frame = await receive();
      if (frame.id === 2) {
        expect(frame.result?.status).toBe(202);
        approved = true;
      }
      if (frame.params?.event.type === "unit.started") running = true;
    }
    clearTimeout(startupLimit);

    const boundedExit = Promise.race([exited, new Promise<never>((_, reject) => {
      shutdownLimit = setTimeout(() => reject(new Error("Sidecar did not exit within five seconds")), 5_000);
    })]);
    if (rpc) send(3, "shutdown");
    else child.stdin.end();
    const response = rpc ? receive().then((frame) => {
      expect(frame).toEqual({ id: 3, jsonrpc: "2.0", result: { status: "shutting_down" } });
    }) : undefined;
    const [exit] = await Promise.all([boundedExit, response]);
    expect(exit).toEqual([0, null]);

    const log = await SqliteEventLog.open(join(directory, "events.sqlite"));
    try {
      expect(log.events).toContainEqual(expect.objectContaining({
        type: "attempt.ended", mission_id: "demo", payload: { result: "cancelled" },
      }));
      if (!hangs) expect(log.events.at(-1)).toMatchObject({ type: "mission.finished", payload: { stopped: true } });
    } finally {
      await log.close();
    }
  } finally {
    clearTimeout(startupLimit);
    clearTimeout(shutdownLimit);
    output.close();
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
