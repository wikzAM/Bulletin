import type { z } from "zod";
import { extractJson, type ModelCall } from "../general";

export async function requestModelJson<T>(call: ModelCall, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const first = await call(system, user);
  try {
    return schema.parse(extractJson(first));
  } catch {
    const retry = await call(system, `${user}\n\nThe previous response was invalid. Reply only with valid JSON matching the requested shape.`);
    return schema.parse(extractJson(retry));
  }
}
