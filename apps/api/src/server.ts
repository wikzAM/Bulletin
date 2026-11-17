import Fastify, { type FastifyInstance } from "fastify";

/** Build the API server. Routes are added here milestone by milestone. */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", service: "api" }));

  return app;
}
