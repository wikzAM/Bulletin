import { z } from "zod";
import { BULLETIN_TOOLS, type BulletinToolName } from "./index";
import { createBulletinHandlers, TOOL_DESCRIPTIONS, type BulletinServerOptions } from "./server";

/*
 * The Bulletin tools for a station that runs inside the sidecar: the same handlers the MCP server uses, called
 * in-process, with no stdio hop. The shape (`definitions` + `call`) is what SdkStationRunner's `stationTools`
 * option takes; the runner does not import this package.
 */

export interface StationToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StationToolSet {
  definitions: StationToolDefinition[];
  /** Resolves to the text for the model; throws for an error result, which the runner reports as one. */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

// Read when a set is made, not when this file loads: index.ts re-exports this file and defines BULLETIN_TOOLS.
const toolNames = () => Object.keys(BULLETIN_TOOLS) as BulletinToolName[];

/** Tools where `unit_id` says who is speaking. The attempt fixes it; for bulletin_read it is only a filter, so the model keeps it. */
const SPEAKS_AS_UNIT: readonly BulletinToolName[] = ["bulletin_ask", "bulletin_post"];

/** What the model supplies for a tool. */
function modelSchema(name: BulletinToolName): z.ZodType {
  const schema = BULLETIN_TOOLS[name];
  return SPEAKS_AS_UNIT.includes(name) ? (schema as z.ZodObject<{ unit_id: z.ZodType }>).omit({ unit_id: true }) : schema;
}

/**
 * One attempt's Bulletin tools. Make a new set for every attempt: the question limit (10 by default) and
 * its blocker dispatch live with the set. `unit_id` is injected here, so a model cannot ask or post as
 * another unit.
 */
export function createStationTools(options: BulletinServerOptions, unit_id: string): StationToolSet {
  const handlers = createBulletinHandlers(options);
  const NAMES = toolNames();
  const schemas = Object.fromEntries(NAMES.map((n) => [n, modelSchema(n)])) as Record<BulletinToolName, z.ZodType>;

  return {
    definitions: NAMES.map((name) => {
      const { $schema: _ignored, ...input_schema } = z.toJSONSchema(schemas[name]) as Record<string, unknown>;
      return { name, description: TOOL_DESCRIPTIONS[name], input_schema };
    }),

    async call(name, args) {
      if (!NAMES.includes(name as BulletinToolName)) throw new Error(`unknown tool: ${name}`);
      const tool = name as BulletinToolName;
      const parsed = schemas[tool].safeParse(args);
      if (!parsed.success) {
        throw new Error(`invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"} ${i.message}`).join("; ")}`);
      }
      const withUnit = { ...(parsed.data as Record<string, unknown>), ...(SPEAKS_AS_UNIT.includes(tool) ? { unit_id } : {}) };
      const outcome = await (handlers[tool] as (a: never) => Promise<{ text: string; isError: boolean }>)(withUnit as never);
      if (outcome.isError) throw new Error(outcome.text);
      return outcome.text;
    },
  };
}
