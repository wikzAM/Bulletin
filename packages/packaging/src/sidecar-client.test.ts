import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSidecar } from "./sidecar-client";

/** A stand-in sidecar: answers health, rejects unknown methods, and sends two events after a subscribe. */
const FAKE = `
import { createInterface } from "node:readline";
const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const r = JSON.parse(line);
  if (r.method === "health") send({ id: r.id, result: { status: "ok" } });
  else if (r.method === "subscribe") {
    send({ id: r.id, result: { subscription_id: 1 } });
    send({ method: "event", params: { subscription_id: 1, event: { id: 1, type: "unit.started" } } });
    send({ method: "event", params: { subscription_id: 1, event: { id: 2, type: "mission.finished" } } });
  } else if (r.method === "hang") { /* never answers */ }
  else send({ id: r.id, error: { code: -32601, message: "Method not found" } });
}).on("close", () => process.exit(0));
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bulletin-client-"));
  writeFileSync(join(dir, "fake.mjs"), FAKE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

describe("startSidecar", () => {
  it("sends a request and resolves with its result", async () => {
    const sidecar = await startSidecar(process.execPath, [join(dir, "fake.mjs")]);
    try {
      expect(await sidecar.request("health")).toEqual({ status: "ok" });
    } finally {
      await sidecar.close();
    }
  });

  it("rejects with the protocol error's code and message", async () => {
    const sidecar = await startSidecar(process.execPath, [join(dir, "fake.mjs")]);
    try {
      await expect(sidecar.request("nope")).rejects.toMatchObject({ code: -32601, message: "Method not found" });
    } finally {
      await sidecar.close();
    }
  });

  it("collects notifications, and waitForEvent resolves on the first match, including one that already arrived", async () => {
    const sidecar = await startSidecar(process.execPath, [join(dir, "fake.mjs")]);
    try {
      await sidecar.request("subscribe", { mission_id: "m" });
      const finished = await sidecar.waitForEvent((e) => e.type === "mission.finished", 5_000);
      expect(finished).toMatchObject({ id: 2 });
      expect(sidecar.events.map((e) => e.type)).toEqual(["unit.started", "mission.finished"]);
    } finally {
      await sidecar.close();
    }
  });

  it("times out a request that is never answered, and an event that never comes", async () => {
    const sidecar = await startSidecar(process.execPath, [join(dir, "fake.mjs")]);
    try {
      await expect(sidecar.request("hang", {}, 200)).rejects.toThrow(/timed out/i);
      await expect(sidecar.waitForEvent(() => false, 200)).rejects.toThrow(/timed out/i);
    } finally {
      await sidecar.close();
    }
  });

  it("close ends the process by closing stdin and reports its exit code", async () => {
    const sidecar = await startSidecar(process.execPath, [join(dir, "fake.mjs")]);
    expect(await sidecar.close()).toBe(0);
  });

  it("rejects requests still waiting when the process dies", async () => {
    writeFileSync(join(dir, "die.mjs"), "setTimeout(() => process.exit(3), 100); setInterval(() => {}, 1000);");
    const sidecar = await startSidecar(process.execPath, [join(dir, "die.mjs")]);
    await expect(sidecar.request("health", {}, 5_000)).rejects.toThrow(/exited/i);
  });
});
