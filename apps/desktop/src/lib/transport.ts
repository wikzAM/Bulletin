import type { BulletinEvent } from "@bulletin/core";
import { parseEventData } from "./guards";

export type TransportKind = "http" | "tauri";

export interface TransportResult {
  status: number;
  body: unknown;
}

/**
 * One way to talk to the engine: JSON request/response, plus a mission event stream.
 * HTTP uses fetch + EventSource; Tauri uses invoke("rpc") and listen("bulletin://event") (docs/SIDECAR.md).
 */
export interface Transport {
  request(method: string, path: string, body?: unknown): Promise<TransportResult>;
  /** Delivers each event of the mission after `after`, once, in order. Returns a function that stops it. */
  subscribe(missionId: string, after: number, onEvent: (event: BulletinEvent) => void, onError?: (error: Error) => void): () => void;
}

/** What the Tauri `invoke` function does: a command name and named arguments in, the command's result out. */
export type TauriInvoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
export type TauriListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

/** A JSON-RPC failure from the sidecar bridge: -32000 when the sidecar is down or restarting, else the sidecar's code. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** The Rust `rpc` command rejects with `{ code, message }`; give that a type so callers can look at the code. */
export function asRpcError(error: unknown): unknown {
  if (error instanceof RpcError) return error;
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === "number" && typeof message === "string") return new RpcError(code, message);
  }
  return error;
}

/** The sidecar is not running at this moment (it is starting or restarting). */
export const SIDECAR_UNAVAILABLE = -32000;

export function detectTransportKind(global: { __TAURI_INTERNALS__?: unknown } = globalThis as { __TAURI_INTERNALS__?: unknown }): TransportKind {
  return global.__TAURI_INTERNALS__ !== undefined ? "tauri" : "http";
}

export function createHttpTransport(opts: {
  baseUrl: string;
  fetchFn?: typeof fetch;
  EventSourceCtor?: typeof EventSource;
}): Transport {
  const base = opts.baseUrl.replace(/\/$/, "");
  const fetchFn = opts.fetchFn ?? fetch;

  return {
    async request(method, path, body) {
      const res = await fetchFn(`${base}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },

    subscribe(missionId, after, onEvent) {
      const EventSourceCtor = opts.EventSourceCtor ?? globalThis.EventSource;
      if (!EventSourceCtor) throw new Error("EventSource is not available in this environment");
      const url = `${base}/missions/${encodeURIComponent(missionId)}/events?after=${after}`;
      const es = new EventSourceCtor(url);
      const onFrame = (msg: MessageEvent<string>) => {
        const event = parseEventData(msg.data);
        if (event && event.mission_id === missionId && event.id > after) onEvent(event);
      };
      es.onmessage = onFrame;
      return () => es.close();
    },
  };
}

function isTransportResult(value: unknown): value is TransportResult {
  return typeof value === "object" && value !== null && typeof (value as { status?: unknown }).status === "number";
}

const DEFAULT_RETRY_MS = 500;

export function createTauriTransport(opts: { invoke: TauriInvoke; listen: TauriListen; retryDelayMs?: number }): Transport {
  const retryDelay = opts.retryDelayMs ?? DEFAULT_RETRY_MS;
  const rpc = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    try {
      return await opts.invoke("rpc", { method, params });
    } catch (error) {
      throw asRpcError(error);
    }
  };

  return {
    async request(method, path, body) {
      const result = await rpc("request", body === undefined ? { method, path } : { method, path, body });
      if (!isTransportResult(result)) throw new Error("Unexpected response from the sidecar");
      return { status: result.status, body: result.body ?? null };
    },

    subscribe(missionId, after, onEvent, onError) {
      let last = after;
      let cancelled = false;
      let unlisten: (() => void) | null = null;
      let subscriptionId: number | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: unknown) => onError?.(error instanceof Error ? error : new Error(String(error)));

      // Rust emits replayed events from its own reader thread, so some can arrive before the subscribe call
      // returns: filter by mission and event id (not by subscription id), and listen before subscribing.
      const subscribe = async (): Promise<void> => {
        if (cancelled) return;
        try {
          const result = (await rpc("subscribe", { mission_id: missionId, after: last })) as { subscription_id?: unknown } | null;
          const id = result?.subscription_id;
          if (typeof id !== "number") throw new Error("Unexpected response from the sidecar");
          if (cancelled) {
            void rpc("unsubscribe", { subscription_id: id }).catch(() => undefined);
            return;
          }
          subscriptionId = id;
        } catch (error) {
          if (cancelled) return;
          if (error instanceof RpcError && error.code === SIDECAR_UNAVAILABLE) {
            // Starting or restarting: ask again from the last event delivered.
            timer = setTimeout(() => void subscribe(), retryDelay);
            return;
          }
          fail(error);
        }
      };

      opts
        .listen("bulletin://event", (event) => {
          const parsed = eventFromPayload(event.payload);
          if (!parsed || parsed.mission_id !== missionId || parsed.id <= last) return;
          last = parsed.id;
          onEvent(parsed);
        })
        .then((stop) => {
          if (cancelled) {
            stop();
            return;
          }
          unlisten = stop;
          return subscribe();
        })
        .catch(fail);

      return () => {
        cancelled = true;
        clearTimeout(timer);
        unlisten?.();
        unlisten = null;
        if (subscriptionId !== null) {
          void rpc("unsubscribe", { subscription_id: subscriptionId }).catch(() => undefined);
          subscriptionId = null;
        }
      };
    },
  };
}

/** Browser: HTTP against VITE_API_URL. Desktop window: Tauri rpc + events (dynamic import). */
export async function createDefaultTransport(baseUrl = process.env.VITE_API_URL ?? import.meta.env?.VITE_API_URL ?? ""): Promise<Transport> {
  if (detectTransportKind() === "tauri") {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    return createTauriTransport({
      invoke: (cmd, args) => invoke<unknown>(cmd, args),
      listen: (event, handler) => listen(event, handler),
    });
  }
  return createHttpTransport({ baseUrl: baseUrl.replace(/\/$/, "") });
}

/** The `bulletin://event` payload is the notification's params, `{ subscription_id, event }`. */
function eventFromPayload(payload: unknown): BulletinEvent | null {
  if (payload && typeof payload === "object" && "event" in payload && !("type" in payload)) {
    return asBulletinEvent((payload as { event: unknown }).event);
  }
  return asBulletinEvent(payload);
}

function asBulletinEvent(payload: unknown): BulletinEvent | null {
  if (payload && typeof payload === "object" && "type" in payload && "id" in payload) {
    return payload as BulletinEvent;
  }
  if (typeof payload === "string") return parseEventData(payload);
  return null;
}
