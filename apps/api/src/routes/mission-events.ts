import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { EventLog } from "../store/event-log";
import { MissionEventFeed } from "./mission-event-feed";
import { validateIdParams } from "./request-validation";

function parseCursor(value: unknown): number | undefined {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : undefined;
}

function waitForDrain(stream: PassThrough): Promise<void> {
  return new Promise((resolve) => {
    function ready() {
      stream.removeListener("drain", ready);
      stream.removeListener("close", ready);
      resolve();
    }
    stream.once("drain", ready);
    stream.once("close", ready);
  });
}

function followMission(feed: MissionEventFeed, missionId: string, after: number): PassThrough {
  const stream = new PassThrough();
  if (!feed.isFinished(missionId)) stream.write(": connected\n\n");
  const unsubscribe = feed.subscribe(missionId, after, {
    event(event) {
      if (stream.destroyed || stream.writableEnded) return;
      const frame = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      if (!stream.write(frame)) return waitForDrain(stream);
    },
    end() { stream.end(); },
    error(error) { stream.destroy(error instanceof Error ? error : new Error(String(error))); },
  });
  const heartbeat = setInterval(() => {
    if (!stream.destroyed && !stream.writableEnded && !stream.writableNeedDrain) stream.write(": keep-alive\n\n");
  }, 15_000).unref();
  stream.once("close", () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
  return stream;
}

export function registerMissionEventStream(app: FastifyInstance, log: EventLog, feed = new MissionEventFeed(log)): void {
  const streams = new Set<PassThrough>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });

  app.get<{ Params: { id: string }; Querystring: { after?: unknown } }>(
    "/missions/:id/events",
    { exposeHeadRoute: false, preValidation: validateIdParams },
    async (request, reply) => {
      const { id } = request.params;
      if (!log.events.some((event) => event.mission_id === id && event.type === "mission.created")) {
        return reply.code(404).send({ error: "Mission not found" });
      }

      const lastEventId = request.headers["last-event-id"];
      const cursor = parseCursor(lastEventId === "" || lastEventId === undefined ? request.query.after : lastEventId);
      if (cursor === undefined) return reply.code(400).send({ error: "Invalid event cursor" });
      if (feed.isFinished(id) && !log.events.some((event) => event.id > cursor && event.mission_id === id)) {
        return reply.code(204).header("Cache-Control", "no-store").send();
      }

      const stream = followMission(feed, id, cursor);
      streams.add(stream);
      const disconnect = () => stream.destroy();
      reply.raw.once("close", disconnect);
      stream.once("close", () => {
        reply.raw.removeListener("close", disconnect);
        streams.delete(stream);
      });
      return reply
        .type("text/event-stream; charset=utf-8")
        .header("Cache-Control", "no-cache, no-transform")
        .header("X-Accel-Buffering", "no")
        .send(stream);
    },
  );
}
