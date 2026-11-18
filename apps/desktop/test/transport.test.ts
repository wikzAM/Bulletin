import { describe, expect, it, vi } from "vitest";
import type { BulletinEvent } from "@bulletin/core";
import {
  createHttpTransport,
  createTauriTransport,
  detectTransportKind,
  RpcError,
  type Transport,
} from "../src/lib/transport";

const sample: BulletinEvent = {
  id: 3,
  mission_id: "m1",
  ts: "2026-11-18T12:00:00.000Z",
  type: "unit.started",
  unit_id: "store",
  payload: {},
};

describe("detectTransportKind", () => {
  it("picks tauri when the Tauri internals global is present", () => {
    expect(detectTransportKind({ __TAURI_INTERNALS__: {} })).toBe("tauri");
    expect(detectTransportKind({})).toBe("http");
  });
});

describe("HTTP transport", () => {
  it("request GETs and POSTs JSON against the base URL", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/missions") && (!init || init.method === "GET" || !init.method)) {
        return new Response(JSON.stringify({ missions: [{ id: "m1" }] }), { status: 200 });
      }
      if (url.endsWith("/missions/m1/stop") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({});
        return new Response(JSON.stringify({ status: "stopping" }), { status: 202 });
      }
      return new Response("nope", { status: 500 });
    });
    const t = createHttpTransport({ baseUrl: "http://api.test", fetchFn });
    expect(await t.request("GET", "/missions")).toEqual({ status: 200, body: { missions: [{ id: "m1" }] } });
    expect(await t.request("POST", "/missions/m1/stop", {})).toEqual({ status: 202, body: { status: "stopping" } });
  });

  it("subscribe opens EventSource with after and delivers parsed events", async () => {
    const sources: FakeEventSource[] = [];
    class FakeEventSource {
      url: string;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        sources.push(this);
      }
      close() {
        /* noop */
      }
    }
    const onEvent = vi.fn();
    const t = createHttpTransport({
      baseUrl: "http://api.test",
      EventSourceCtor: FakeEventSource as unknown as typeof EventSource,
    });
    const stop = t.subscribe("m1", 2, onEvent);
    expect(sources[0]?.url).toBe("http://api.test/missions/m1/events?after=2");
    sources[0]!.onmessage?.({ data: JSON.stringify(sample) } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith(sample);
    stop();
  });
});

/** A fake Tauri host: records every rpc call and lets a test push `bulletin://event` payloads the way Rust emits them. */
function fakeTauri(handlers: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const listeners = new Set<(event: { payload: unknown }) => void>();
  const unlisten = vi.fn();
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    expect(cmd).toBe("rpc");
    const { method, params } = args as { method: string; params: Record<string, unknown> };
    calls.push({ method, params });
    const handler = handlers[method];
    if (!handler) throw { code: -32601, message: "Method not found" };
    return handler(params);
  });
  const listen = vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
      unlisten();
    };
  });
  /** Rust emits the notification's params: { subscription_id, event }. */
  const emit = (event: BulletinEvent | Record<string, unknown>, subscriptionId = 1) =>
    listeners.forEach((l) => l({ payload: { subscription_id: subscriptionId, event } }));
  return { invoke, listen, calls, emit, unlisten, listeners };
}

describe("Tauri transport", () => {
  it("request forwards the HTTP call to the sidecar's request method and returns status and body", async () => {
    const host = fakeTauri({ request: () => ({ status: 200, body: { id: "m1" } }) });
    const t = createTauriTransport(host);
    expect(await t.request("GET", "/missions/m1")).toEqual({ status: 200, body: { id: "m1" } });
    expect(host.calls).toEqual([{ method: "request", params: { method: "GET", path: "/missions/m1" } }]);
    await t.request("POST", "/missions/m1/stop", {});
    expect(host.calls[1]).toEqual({ method: "request", params: { method: "POST", path: "/missions/m1/stop", body: {} } });
  });

  it("an HTTP error is still a result, a protocol failure is an RpcError with its code", async () => {
    const notFound = createTauriTransport(fakeTauri({ request: () => ({ status: 404, body: { error: "Route not found" } }) }));
    expect(await notFound.request("GET", "/nope")).toEqual({ status: 404, body: { error: "Route not found" } });

    const down = createTauriTransport(
      fakeTauri({
        request: () => {
          throw { code: -32000, message: "Sidecar unavailable" };
        },
      }),
    );
    await expect(down.request("GET", "/missions")).rejects.toMatchObject({ code: -32000, message: "Sidecar unavailable" });
    await expect(down.request("GET", "/missions")).rejects.toBeInstanceOf(RpcError);

    const odd = createTauriTransport(fakeTauri({ request: () => "not a result" }));
    await expect(odd.request("GET", "/missions")).rejects.toThrow(/unexpected/i);
  });

  it("subscribe listens first, then asks the sidecar to subscribe from the cursor, and delivers each event once", async () => {
    const host = fakeTauri({ subscribe: () => ({ subscription_id: 1 }), unsubscribe: () => ({ unsubscribed: true }) });
    const t = createTauriTransport(host);
    const onEvent = vi.fn();
    const stop = t.subscribe("m1", 2, onEvent);
    await vi.waitFor(() => expect(host.calls.map((c) => c.method)).toEqual(["subscribe"]));
    expect(host.listen).toHaveBeenCalledWith("bulletin://event", expect.any(Function));
    expect(host.listen.mock.invocationCallOrder[0]!).toBeLessThan(host.invoke.mock.invocationCallOrder[0]!);
    expect(host.calls[0]!.params).toEqual({ mission_id: "m1", after: 2 });

    host.emit(sample);
    host.emit(sample); // duplicate
    host.emit({ ...sample, id: 2 }); // at or before the cursor
    host.emit({ ...sample, id: 4, mission_id: "other" }); // another mission
    host.emit({ ...sample, id: 5 });
    expect(onEvent.mock.calls.map(([e]) => e.id)).toEqual([3, 5]);

    stop();
    expect(host.unlisten).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(host.calls.map((c) => c.method)).toEqual(["subscribe", "unsubscribe"]));
    expect(host.calls[1]!.params).toEqual({ subscription_id: 1 });
    host.emit({ ...sample, id: 9 });
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("keeps events that arrive before the subscribe call returns (Rust emits replay from its reader thread)", async () => {
    let finish!: (value: unknown) => void;
    const host = fakeTauri({
      subscribe: () => new Promise((resolve) => (finish = resolve)),
      unsubscribe: () => ({ unsubscribed: true }),
    });
    const t = createTauriTransport(host);
    const onEvent = vi.fn();
    const stop = t.subscribe("m1", 0, onEvent);
    await vi.waitFor(() => expect(host.calls).toHaveLength(1));
    host.emit(sample, 7); // a replayed event whose subscription id the transport has not been told yet
    expect(onEvent).toHaveBeenCalledWith(sample);
    finish({ subscription_id: 7 });
    stop();
  });

  it("unwraps the notification's event, and still accepts a bare event or JSON text", async () => {
    const host = fakeTauri({ subscribe: () => ({ subscription_id: 1 }) });
    const t = createTauriTransport(host);
    const onEvent = vi.fn();
    t.subscribe("m1", 0, onEvent);
    await vi.waitFor(() => expect(host.calls).toHaveLength(1));
    for (const listener of host.listeners) {
      listener({ payload: { ...sample, id: 1 } });
      listener({ payload: JSON.stringify({ ...sample, id: 2 }) });
      listener({ payload: { subscription_id: 1, event: "garbage" } });
      listener({ payload: null });
      listener({ payload: { subscription_id: 1 } });
    }
    expect(onEvent.mock.calls.map(([e]) => e.id)).toEqual([1, 2]);
  });

  it("subscribes again while the sidecar is unavailable, from the last event it delivered", async () => {
    let attempts = 0;
    const host = fakeTauri({
      subscribe: () => {
        attempts += 1;
        if (attempts < 3) throw { code: -32000, message: "Sidecar unavailable" };
        return { subscription_id: 4 };
      },
    });
    const t = createTauriTransport({ ...host, retryDelayMs: 1 });
    const onEvent = vi.fn();
    t.subscribe("m1", 0, onEvent);
    await vi.waitFor(() => expect(host.calls.map((c) => c.method)).toEqual(["subscribe", "subscribe", "subscribe"]));
    host.emit({ ...sample, id: 6 });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(host.calls.map((c) => c.params.after)).toEqual([0, 0, 0]);
  });

  it("reports a subscribe the sidecar refuses, and stops retrying after stop()", async () => {
    const refused = fakeTauri({
      subscribe: () => {
        throw { code: -32004, message: "Mission not found" };
      },
    });
    const onError = vi.fn();
    createTauriTransport(refused).subscribe("missing", 0, vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toMatchObject({ code: -32004 });
    expect(refused.calls).toHaveLength(1);

    const down = fakeTauri({
      subscribe: () => {
        throw { code: -32000, message: "Sidecar unavailable" };
      },
    });
    const stop = createTauriTransport({ ...down, retryDelayMs: 1 }).subscribe("m1", 0, vi.fn());
    await vi.waitFor(() => expect(down.calls.length).toBeGreaterThanOrEqual(2));
    stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const seen = down.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(down.calls.length).toBe(seen);
  });

  it("stop() right away releases the listener and never subscribes", async () => {
    const host = fakeTauri({ subscribe: () => ({ subscription_id: 3 }), unsubscribe: () => ({ unsubscribed: true }) });
    const t = createTauriTransport(host);
    t.subscribe("m1", 0, vi.fn())();
    await vi.waitFor(() => expect(host.unlisten).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host.listeners.size).toBe(0);
    expect(host.calls.filter((c) => c.method === "subscribe")).toHaveLength(0);
  });
});

describe("Transport shape", () => {
  it("both fakes satisfy the shared interface", async () => {
    const http: Transport = createHttpTransport({
      baseUrl: "http://x",
      fetchFn: async () => new Response("{}", { status: 200 }),
    });
    const tauri: Transport = createTauriTransport({
      invoke: async () => ({ status: 200, body: {} }),
      listen: async () => () => undefined,
    });
    expect(await http.request("GET", "/")).toMatchObject({ status: 200 });
    expect(await tauri.request("GET", "/")).toMatchObject({ status: 200 });
  });
});
