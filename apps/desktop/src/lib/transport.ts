import type { BulletinEvent } from "@bulletin/core";
import { parseEventData } from "./guards";

export type TransportKind = "http" | "tauri";

export interface TransportResult {
  status: number;
  body: unknown;
}

/**
 * One way to talk to the engine: JSON request/response, plus a mission event stream.
 * HTTP uses fetch + EventSource; Tauri uses invoke("rpc") and listen("bulletin://event").
 */
export interface Transport {
  request(method: string, path: string, body?: unknown): Promise<TransportResult>;
  subscribe(missionId: string, after: number, onEvent: (event: BulletinEvent) => void): () => void;
}

export type TauriInvoke = (cmd: string, args: Record<string, unknown>) => Promise<TransportResult>;
export type TauriListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

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

export function createTauriTransport(opts: { invoke: TauriInvoke; listen: TauriListen }): Transport {
  return {
    request(method, path, body) {
      return opts.invoke("rpc", { method, path, body });
    },

    subscribe(missionId, after, onEvent) {
      let last = after;
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      void opts.listen("bulletin://event", (event) => {
        const parsed = asBulletinEvent(event.payload);
        if (!parsed || parsed.mission_id !== missionId || parsed.id <= last) return;
        last = parsed.id;
        onEvent(parsed);
      }).then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      });
      return () => {
        cancelled = true;
        unlisten?.();
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
      invoke: (cmd, args) => invoke<TransportResult>(cmd, args),
      listen: (event, handler) => listen(event, handler),
    });
  }
  return createHttpTransport({ baseUrl: baseUrl.replace(/\/$/, "") });
}

function asBulletinEvent(payload: unknown): BulletinEvent | null {
  if (payload && typeof payload === "object" && "type" in payload && "id" in payload) {
    return payload as BulletinEvent;
  }
  if (typeof payload === "string") return parseEventData(payload);
  return null;
}
