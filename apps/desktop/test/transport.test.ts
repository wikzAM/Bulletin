import { describe, expect, it, vi } from "vitest";
import type { BulletinEvent } from "@bulletin/core";
import {
  createHttpTransport,
  createTauriTransport,
  detectTransportKind,
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

describe("Tauri transport", () => {
  it("request invokes rpc and subscribe listens for bulletin://event", async () => {
    const invoke = vi.fn(async (_cmd: string, args: Record<string, unknown>) => {
      expect(args).toEqual({ method: "GET", path: "/missions/m1", body: undefined });
      return { status: 200, body: { id: "m1" } };
    });
    const unlisten = vi.fn();
    const listen = vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
      handler({ payload: sample });
      return unlisten;
    });
    const t = createTauriTransport({ invoke, listen });
    expect(await t.request("GET", "/missions/m1")).toEqual({ status: 200, body: { id: "m1" } });
    const onEvent = vi.fn();
    const stop = t.subscribe("m1", 0, onEvent);
    await vi.waitFor(() => expect(listen).toHaveBeenCalledWith("bulletin://event", expect.any(Function)));
    expect(onEvent).toHaveBeenCalledWith(sample);
    stop();
    expect(unlisten).toHaveBeenCalled();
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
