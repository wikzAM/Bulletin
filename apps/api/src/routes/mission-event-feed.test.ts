import { get, type ClientRequest, type IncomingMessage } from "node:http";
import { MemoryEventLog, type BulletinEvent } from "@bulletin/core";
import { expect, it } from "vitest";
import { buildServer } from "../server";
import { MissionEventFeed } from "./mission-event-feed";

function observe(feed: MissionEventFeed, after = 0) {
  const events: BulletinEvent[] = [];
  let disconnect: () => void = () => {};
  const ended = new Promise<void>((end, error) => {
    disconnect = feed.subscribe("demo", after, { event: (event) => { events.push(event); }, end, error });
  });
  return { events, ended, disconnect };
}

it("replays a finished mission and ends, including when the cursor is beyond all events", async () => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  const created = await log.emit({ mission_id, type: "mission.created" });
  const finished = await log.emit({ mission_id, type: "mission.finished" });
  await log.emit({ mission_id: "other", type: "mission.created" });
  const feed = new MissionEventFeed(log);

  const replay = observe(feed, created.id);
  const pastEnd = observe(feed, log.events.length + 100);
  await Promise.all([replay.ended, pastEnd.ended]);
  expect(replay.events).toEqual([finished]);
  expect(pastEnd.events).toEqual([]);
  expect(feed.listenerCount("demo")).toBe(0);
}, 30_000);

it("delivers live events to two subscribers and removes a disconnected listener", async () => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  const created = await log.emit({ mission_id, type: "mission.created" });
  const feed = new MissionEventFeed(log);
  const first = observe(feed, created.id);
  const second = observe(feed, created.id);
  try {
    expect(feed.listenerCount("demo")).toBe(2);
    const started = await log.emit({ mission_id, type: "wave.started" });
    await expect.poll(() => first.events, { timeout: 20_000 }).toEqual([started]);
    await expect.poll(() => second.events, { timeout: 20_000 }).toEqual([started]);

    first.disconnect();
    expect(feed.listenerCount("demo")).toBe(1);
    const finished = await log.emit({ mission_id, type: "mission.finished" });
    await second.ended;
    expect(first.events).toEqual([started]);
    expect(second.events).toEqual([started, finished]);
    expect(feed.listenerCount("demo")).toBe(0);
  } finally {
    first.disconnect();
    second.disconnect();
  }
}, 30_000);

it("responds with no content when a finished mission has no remaining replay", async () => {
  const log = new MemoryEventLog();
  const mission_id = "demo";
  await log.emit({ mission_id, type: "mission.created" });
  const finished = await log.emit({ mission_id, type: "mission.finished" });
  await log.emit({ mission_id: "other", type: "mission.created" });
  const feed = new MissionEventFeed(log);
  const app = buildServer(log, { missionEventFeed: feed });
  const url = "/missions/demo/events";
  try {
    const replay = await app.inject(url);
    expect(replay.statusCode).toBe(200);
    expect(replay.payload).toContain("event: mission.finished\n");

    const reconnect = await app.inject({ url, headers: { "last-event-id": String(finished.id) } });
    const pastEnd = await app.inject(`${url}?after=${finished.id + 100}`);
    for (const response of [reconnect, pastEnd]) {
      expect(response.statusCode).toBe(204);
      expect(response.payload).toBe("");
    }
    expect(feed.listenerCount(mission_id)).toBe(0);
  } finally {
    await app.close();
  }
}, 30_000);

it("detaches an interrupted SSE request without closing the other client", async () => {
  const log = new MemoryEventLog();
  await log.emit({ mission_id: "demo", type: "mission.created" });
  const feed = new MissionEventFeed(log);
  const app = buildServer(log, { missionEventFeed: feed });
  const requests: ClientRequest[] = [];
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const url = `${address}/missions/demo/events`;
    const responses = [0, 1].map(() => new Promise<IncomingMessage>((resolve, reject) => {
      const request = get(url, { agent: false, signal: AbortSignal.timeout(20_000) }, resolve);
      request.on("error", reject);
      requests.push(request);
    }));
    const [first, second] = await Promise.all(responses);
    expect(first!.statusCode).toBe(200);
    expect(second!.statusCode).toBe(200);
    expect(feed.listenerCount("demo")).toBe(2);

    first!.destroy();
    await expect.poll(() => feed.listenerCount("demo"), { timeout: 10_000 }).toBe(1);
    await log.emit({ mission_id: "demo", type: "mission.finished" });

    let body = "";
    for await (const chunk of second!.setEncoding("utf8")) body += chunk;
    expect(body).toContain("event: mission.finished\n");
    expect(feed.listenerCount("demo")).toBe(0);
  } finally {
    for (const request of requests) request.destroy();
    await app.close();
  }
}, 30_000);
