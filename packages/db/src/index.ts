import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export * as schema from "./schema";

/** Connect to Postgres. The URL comes from DATABASE_URL, never from code. */
export function createDb(url: string) {
  return drizzle(url, { schema });
}

export type Db = ReturnType<typeof createDb>;
