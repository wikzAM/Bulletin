import { STATUS_CODES } from "node:http";
import { MemoryEventLog } from "@bulletin/core";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { ModelCall } from "./general";
import { registerBriefings } from "./routes/briefings";
import { registerMissionApproval, type MissionStarter } from "./routes/mission-approval";
import { registerMissionPlanning } from "./routes/mission-planning";
import { registerMissionRoutes } from "./routes/missions";
import { registerQuestionRoutes } from "./routes/questions";
import type { QuestionStore } from "./routes/questions-store";
import { MemoryBriefingStore, type BriefingStore } from "./store/briefing-store";
import type { EventLog } from "./store/event-log";

export interface ServerOptions {
  briefingStore?: BriefingStore;
  interviewerCall?: ModelCall;
  modelCall?: ModelCall;
  questionStore?: QuestionStore;
  startMission?: MissionStarter;
}

const webOrigin = "http://localhost:3000";

function setOriginHeader(request: FastifyRequest, reply: FastifyReply): void {
  reply.header("Vary", "Origin");
  if (request.headers.origin === webOrigin) reply.header("Access-Control-Allow-Origin", webOrigin);
}

function sendRequestError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const status = error.statusCode ?? 500;
  if (status === 400) return reply.code(400).send({ error: "Invalid request" });
  if (status >= 400 && status < 500) return reply.code(status).send({ error: STATUS_CODES[status] ?? "Request failed" });
  request.log.error({ err: error }, "Request failed");
  return reply.code(500).send({ error: "Internal server error" });
}

/** Pass the same event log to the server and engine when they run together. */
export function buildServer(events: EventLog = new MemoryEventLog(), options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    frameworkErrors(error, request, reply) {
      setOriginHeader(request, reply);
      return sendRequestError(error, request, reply);
    },
  });

  app.setErrorHandler(sendRequestError);
  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: "Route not found" }));
  app.addHook("onRequest", async (request, reply) => {
    setOriginHeader(request, reply);
    if (request.headers.origin === webOrigin && request.method === "OPTIONS" && request.headers["access-control-request-method"]) {
      return reply
        .header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
        .code(204)
        .send();
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "api" }));
  const briefings = options.briefingStore ?? new MemoryBriefingStore();
  registerBriefings(app, briefings, options.interviewerCall);
  registerMissionRoutes(app, events);
  registerMissionPlanning(app, events, briefings, options.modelCall);
  registerMissionApproval(app, events, options.startMission);
  registerQuestionRoutes(app, events, options.questionStore);

  return app;
}
