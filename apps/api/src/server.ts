import { MemoryEventLog } from "@bulletin/core";
import Fastify, { type FastifyInstance } from "fastify";
import { registerMissionRoutes } from "./routes/missions";
import { registerQuestionRoutes } from "./routes/questions";
import type { QuestionStore } from "./routes/questions-store";

export interface ServerOptions {
  questionStore?: QuestionStore;
}

/** Pass the same event log to the server and engine when they run together. */
export function buildServer(events = new MemoryEventLog(), options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", service: "api" }));
  registerMissionRoutes(app, events);
  registerQuestionRoutes(app, events, options.questionStore);

  return app;
}
