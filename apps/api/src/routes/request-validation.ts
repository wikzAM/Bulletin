import type { preValidationAsyncHookHandler } from "fastify";
import { z } from "zod";

export const identifier = z.string().refine((value) => value.trim().length > 0);
const idParams = z.object({ id: identifier });

export const validateIdParams: preValidationAsyncHookHandler = async (request, reply) => {
  if (!idParams.safeParse(request.params).success) {
    return reply.code(400).send({ error: "Invalid request" });
  }
};
