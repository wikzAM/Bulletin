import { describe, expect, it } from "vitest";
import { copy } from "../src/lib/copy";
import { createTauriTransport, RpcError, SIDECAR_UNAVAILABLE } from "../src/lib/transport";

describe("when the background service is down", () => {
  it("names the problem in plain words and offers Retry", () => {
    expect(copy.states.error.title).toBe("Bulletin's background service is not running");
    expect(copy.states.error.retry).toBe("Retry");
    expect(copy.states.error.body).not.toMatch(/-32000|rpc|sidecar|exception|stack/i);
  });

  it("a request fails with the 'service unavailable' code that every page turns into that state", async () => {
    const down = createTauriTransport({
      invoke: async () => {
        throw { code: SIDECAR_UNAVAILABLE, message: "The background service is not running" };
      },
      listen: async () => () => undefined,
    });
    const error = await down.request("GET", "/missions").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe(SIDECAR_UNAVAILABLE);
  });

  it("a request works again on the next try once the service is back (what Retry does)", async () => {
    let up = false;
    const transport = createTauriTransport({
      invoke: async () => {
        if (!up) throw { code: SIDECAR_UNAVAILABLE, message: "down" };
        return { status: 200, body: [] };
      },
      listen: async () => () => undefined,
    });
    await expect(transport.request("GET", "/missions")).rejects.toBeInstanceOf(RpcError);
    up = true;
    await expect(transport.request("GET", "/missions")).resolves.toEqual({ status: 200, body: [] });
  });
});
