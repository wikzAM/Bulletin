import { createHash, timingSafeEqual } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { MemoryEventLog } from "@bulletin/core";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { ModelCall } from "./general";
import { registerBriefings } from "./routes/briefings";
import { registerConfig, type ConfigSource } from "./routes/config";
import { registerMissionApproval, type MissionPricing, type MissionStarter } from "./routes/mission-approval";
import { registerMissionDecisions } from "./routes/mission-decisions";
import { registerMissionPlanning } from "./routes/mission-planning";
import { registerMissionRules, type ReadGit } from "./routes/mission-rules";
import { registerMissionRoutes } from "./routes/missions";
import { registerQuestionRoutes } from "./routes/questions";
import type { QuestionStore } from "./routes/questions-store";
import { MemoryBriefingStore, type BriefingStore } from "./store/briefing-store";
import type { EventLog } from "./store/event-log";

export interface ServerOptions {
  answererCall?: ModelCall;
  briefingStore?: BriefingStore;
  config?: ConfigSource;
  interviewerCall?: ModelCall;
  modelCall?: ModelCall;
  pricing?: MissionPricing;
  questionStore?: QuestionStore;
  readGit?: ReadGit;
  startMission?: MissionStarter;
}

const defaultWebOrigin = "http://localhost:3000";

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function validBearer(authorization: string | undefined, expected: Buffer): boolean {
  const token = /^Bearer[ \t]+([^\s,]+)$/i.exec(authorization ?? "")?.[1];
  return token !== undefined && timingSafeEqual(tokenDigest(token), expected);
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
  const configuredToken = process.env.BULLETIN_API_TOKEN;
  const expectedToken = configuredToken ? tokenDigest(configuredToken) : undefined;
  const origins = new Set((process.env.BULLETIN_WEB_ORIGINS ?? defaultWebOrigin).split(",").map((origin) => origin.trim()).filter(Boolean));

  function setOriginHeader(request: FastifyRequest, reply: FastifyReply): boolean {
    reply.header("Vary", "Origin");
    const { origin } = request.headers;
    if (!origin || !origins.has(origin)) return false;
    reply.header("Access-Control-Allow-Origin", origin);
    return true;
  }

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
    const allowedOrigin = setOriginHeader(request, reply);
    if (allowedOrigin && request.method === "OPTIONS" && request.headers["access-control-request-method"]) {
      return reply
        .header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID")
        .code(204)
        .send();
    }

    const healthCheck = request.method === "GET" && request.routeOptions.url === "/health";
    if (expectedToken && !healthCheck && !validBearer(request.headers.authorization, expectedToken)) {
      return reply.header("WWW-Authenticate", "Bearer").code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "api" }));
  registerConfig(app, options.config);
  const briefings = options.briefingStore ?? new MemoryBriefingStore();
  const pricing = options.pricing ?? (options.config && { prices: options.config.prices, tiers: options.config.models.tiers });
  registerBriefings(app, briefings, options.interviewerCall);
  registerMissionRoutes(app, events);
  registerMissionDecisions(app, events);
  registerMissionRules(app, events, options.readGit);
  registerMissionPlanning(app, events, briefings, options.modelCall);
  registerMissionApproval(app, events, options.startMission, pricing);
  registerQuestionRoutes(app, events, options.questionStore, options.answererCall);

  return app;
}
