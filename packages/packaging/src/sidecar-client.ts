import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/*
 * A minimal client for the sidecar's JSON-RPC protocol (docs/SIDECAR.md), speaking over stdio the way the Tauri
 * `rpc` command does: one JSON object per line, requests carry an id, notifications ("event") do not.
 * Used by the live end-to-end test and the install test, which run the real packaged executable.
 */

export interface SidecarEvent {
  id: number;
  type: string;
  mission_id?: string;
  unit_id?: string | null;
  payload?: Record<string, unknown>;
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SidecarClient {
  /** Every event notification received so far, in order. */
  readonly events: SidecarEvent[];
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** Resolves with the first received event (past or future) that matches. */
  waitForEvent(match: (event: SidecarEvent) => boolean, timeoutMs: number): Promise<SidecarEvent>;
  /** Closes stdin, which is how the sidecar is told to stop, and resolves with its exit code. */
  close(): Promise<number | null>;
  stderr(): string;
  readonly pid: number | undefined;
}

interface Message {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: { event?: SidecarEvent };
}

export async function startSidecar(
  command: string,
  args: string[] = [],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<SidecarClient> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += String(d)));

  const events: SidecarEvent[] = [];
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  const watchers = new Set<{ match: (e: SidecarEvent) => boolean; resolve: (e: SidecarEvent) => void }>();
  let nextId = 1;
  let exited = false;

  const exit = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      exited = true;
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`sidecar exited (code ${code}) before answering`));
      }
      pending.clear();
      resolve(code);
    });
    child.on("error", () => resolve(null));
  });

  createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return; // not protocol output
    }
    if (message.method === "event" && message.params?.event) {
      const event = message.params.event;
      events.push(event);
      for (const w of [...watchers]) {
        if (w.match(event)) {
          watchers.delete(w);
          w.resolve(event);
        }
      }
      return;
    }
    if (typeof message.id === "number") {
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.error) p.reject(new RpcError(message.error.code, message.error.message));
      else p.resolve(message.result);
    }
  });

  return {
    events,
    stderr: () => stderr,
    pid: child.pid,
    request(method, params = {}, timeoutMs = 60_000) {
      if (exited) return Promise.reject(new Error("sidecar exited"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`request ${method} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    waitForEvent(match, timeoutMs) {
      const already = events.find(match);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const watcher = {
          match,
          resolve: (e: SidecarEvent) => {
            clearTimeout(timer);
            resolve(e);
          },
        };
        const timer = setTimeout(() => {
          watchers.delete(watcher);
          reject(new Error(`event wait timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        watchers.add(watcher);
      });
    },
    close() {
      if (!exited) child.stdin.end();
      return exit;
    },
  };
}
