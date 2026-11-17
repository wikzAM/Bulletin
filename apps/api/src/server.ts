import { MemoryEventLog } from "@bulletin/core";
import Fastify, { type FastifyInstance } from "fastify";
import { registerMissionRoutes } from "./routes/missions";

/** Pass the same event log to the server and engine when they run together. */
export function buildServer(events = new MemoryEventLog()): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", service: "api" }));
  registerMissionRoutes(app, events);

  return app;
}
