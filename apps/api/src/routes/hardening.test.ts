import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server";

const webOrigin = "http://localhost:3000";

describe("API request handling", () => {
  let app: ReturnType<typeof buildServer>;

  beforeEach(() => {
    app = buildServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each<{ method: "GET" | "POST"; path: string; payload?: { answer: string } }>([
    { method: "GET", path: "/missions/%20" },
    { method: "GET", path: "/missions/%20/treasury" },
    { method: "GET", path: "/missions/%20/events" },
    { method: "POST", path: "/missions/%20/approve" },
    { method: "POST", path: "/questions/%20/answer", payload: { answer: "Yes" } },
  ])("rejects a blank ID at $method $path", async ({ method, path, payload }) => {
    const res = await app.inject({ method, url: path, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid request" });
  });

  it.each([
    { path: "/missions", payload: { goal: 42, repo: "path" } },
    { path: "/missions/demo/approve", payload: { unexpected: true } },
    { path: "/questions", payload: { mission_id: " ", body: "Question" } },
    { path: "/questions/id/answer", payload: { answer: false } },
  ])("rejects an invalid body at POST $path", async ({ path, payload }) => {
    const res = await app.inject({ method: "POST", url: path, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid request" });
  });

  it("returns one error shape for malformed JSON and missing routes", async () => {
    const badJson = await app.inject({
      method: "POST", url: "/missions", headers: { "content-type": "application/json" }, payload: "{",
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json()).toEqual({ error: "Invalid request" });

    const badUrl = await app.inject("/missions/%GG");
    expect(badUrl.statusCode).toBe(400);
    expect(badUrl.json()).toEqual({ error: "Invalid request" });

    const missing = await app.inject("/missing");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Route not found" });
  });

  it("permits the local web origin on successful and error responses", async () => {
    const [list, missing, other] = await Promise.all([
      app.inject({ url: "/missions", headers: { origin: webOrigin } }),
      app.inject({ url: "/missing", headers: { origin: webOrigin } }),
      app.inject({ url: "/missions", headers: { origin: "http://localhost:3001" } }),
    ]);
    for (const res of [list, missing]) {
      expect(res.headers["access-control-allow-origin"]).toBe(webOrigin);
      expect(res.headers.vary).toBe("Origin");
    }
    expect(list.statusCode).toBe(200);
    expect(missing.statusCode).toBe(404);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    expect(other.headers.vary).toBe("Origin");
  });

  it("handles preflight for JSON writes and SSE reconnects from the local web app", async () => {
    const res = await app.inject({ method: "OPTIONS", url: "/missions", headers: {
      origin: webOrigin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,last-event-id",
    } });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(webOrigin);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    const allowHeaders = res.headers["access-control-allow-headers"]?.toString().toLowerCase();
    expect(allowHeaders).toContain("content-type");
    expect(allowHeaders).toContain("last-event-id");

    const other = await app.inject({ method: "OPTIONS", url: "/missions", headers: {
      origin: "http://localhost:3001", "access-control-request-method": "POST",
    } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
