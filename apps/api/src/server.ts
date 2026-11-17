import { MemoryEventLog } from "@bulletin/core";
import Fastify, { type FastifyInstance } from "fastify";
import type { ModelCall } from "./general";
import { registerMissionPlanning } from "./routes/mission-planning";
import { registerMissionRoutes } from "./routes/missions";
import { registerQuestionRoutes } from "./routes/questions";
import type { QuestionStore } from "./routes/questions-store";

export interface ServerOptions {
  modelCall?: ModelCall;
  questionStore?: QuestionStore;
}

/** Pass the same event log to the server and engine when they run together. */
export function buildServer(events = new MemoryEventLog(), options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", service: "api" }));
  registerMissionRoutes(app, events);
  registerMissionPlanning(app, events, options.modelCall);
  registerQuestionRoutes(app, events, options.questionStore);

  return app;
}
