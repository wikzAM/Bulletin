import { MemoryEventLog } from "@bulletin/core";
import { afterEach, expect, it, vi } from "vitest";
import { buildServer } from "../server";

const token = "fixture-api-token";

afterEach(() => { vi.unstubAllEnvs(); });

it("requires an exact bearer token for routes other than GET /health when configured", async () => {
  vi.stubEnv("BULLETIN_API_TOKEN", token);
  const app = buildServer();
  try {
    expect((await app.inject("/health?check=1")).statusCode).toBe(200);
    expect((await app.inject({ method: "HEAD", url: "/health" })).statusCode).toBe(401);
    for (const authorization of [undefined, "Basic fixture-api-token", "Bearer fixture-api-tokex", `Bearer ${token}, Bearer ${token}`]) {
      const res = await app.inject({ url: "/missions", headers: authorization === undefined ? {} : { authorization } });
      expect(res.statusCode).toBe(401);
      expect(res.headers["www-authenticate"]).toBe("Bearer");
      expect(res.json()).toEqual({ error: "Unauthorized" });
      expect(res.body).not.toContain(token);
    }
    expect((await app.inject({ url: "/missions", headers: { authorization: `bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/missions?token=${token}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/briefings", payload: { goal: "Demo" } })).statusCode).toBe(401);
  } finally {
    await app.close();
  }
});

it("protects SSE and allows credential headers in preflight for configured origins", async () => {
  vi.stubEnv("BULLETIN_API_TOKEN", token);
  vi.stubEnv("BULLETIN_WEB_ORIGINS", "https://ui.example, https://preview.example");
  const log = new MemoryEventLog();
  await log.emit({ mission_id: "demo", type: "mission.created" });
  const app = buildServer(log);
  const url = "/missions/demo/events";
  const origin = "https://preview.example";
  try {
    const preflight = await app.inject({ method: "OPTIONS", url, headers: {
      origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization,last-event-id",
    } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
    expect(preflight.headers["access-control-allow-headers"]?.toString().toLowerCase()).toContain("authorization");

    const denied = await app.inject({ url, headers: { origin }, payloadAsStream: true, signal: AbortSignal.timeout(2000) });
    expect(denied.statusCode).toBe(401);
    denied.stream().resume();
    expect(denied.headers["access-control-allow-origin"]).toBe(origin);

    const allowed = await app.inject({ url, headers: { origin, authorization: `Bearer ${token}` }, payloadAsStream: true, signal: AbortSignal.timeout(2000) });
    expect(allowed.statusCode).toBe(200);
    allowed.stream().resume();
    expect(allowed.headers["content-type"]).toBe("text/event-stream; charset=utf-8");

    const defaultOrigin = await app.inject({ url: "/health", headers: { origin: "http://localhost:3000" } });
    expect(defaultOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  } finally {
    await app.close();
  }
});
