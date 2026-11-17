import { PassThrough } from "node:stream";
import type { MemoryEventLog } from "@bulletin/core";
import type { FastifyInstance } from "fastify";

function parseCursor(value: unknown): number | undefined {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : undefined;
}

function followMission(log: MemoryEventLog, missionId: string, after: number): PassThrough {
  const stream = new PassThrough();
  const firstUnseen = log.events.findIndex((event) => event.id > after);
  let nextIndex = firstUnseen === -1 ? log.events.length : firstUnseen;

  function flushEvents() {
    if (stream.destroyed || stream.writableEnded || stream.writableNeedDrain) return;
    try {
      while (nextIndex < log.events.length) {
        const event = log.events[nextIndex++];
        if (!event || event.id <= after || event.mission_id !== missionId) continue;
        const frame = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        if (!stream.write(frame)) return;
      }
    } catch (error) {
      stream.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // The core log exposes an append-only array. One index covers replay and new
  // appends, including events emitted while a client is still reading history.
  const poll = setInterval(flushEvents, 50).unref();
  const heartbeat = setInterval(() => {
    if (!stream.destroyed && !stream.writableEnded && !stream.writableNeedDrain) stream.write(": keep-alive\n\n");
  }, 15_000).unref();
  stream.once("close", () => {
    clearInterval(poll);
    clearInterval(heartbeat);
  });
  stream.on("drain", flushEvents);
  stream.write(": connected\n\n");
  flushEvents();
  return stream;
}

export function registerMissionEventStream(app: FastifyInstance, log: MemoryEventLog): void {
  const streams = new Set<PassThrough>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });

  app.get<{ Params: { id: string }; Querystring: { after?: unknown } }>(
    "/missions/:id/events",
    { exposeHeadRoute: false },
    async (request, reply) => {
      const { id } = request.params;
      if (!log.events.some((event) => event.mission_id === id && event.type === "mission.created")) {
        return reply.code(404).send({ error: "Mission not found" });
      }

      const lastEventId = request.headers["last-event-id"];
      const cursor = parseCursor(lastEventId === "" || lastEventId === undefined ? request.query.after : lastEventId);
      if (cursor === undefined) return reply.code(400).send({ error: "Invalid event cursor" });

      const stream = followMission(log, id, cursor);
      streams.add(stream);
      stream.once("close", () => streams.delete(stream));
      return reply
        .type("text/event-stream; charset=utf-8")
        .header("Cache-Control", "no-cache, no-transform")
        .header("X-Accel-Buffering", "no")
        .send(stream);
    },
  );
}
