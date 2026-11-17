import { randomUUID } from "node:crypto";
import { DEFAULT_LANES, LanesConfigSchema } from "@bulletin/core";
import { git, tryGit } from "@bulletin/runners/git";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runGeneral, type ModelCall } from "../general";
import type { BriefingStore } from "../store/briefing-store";
import type { EventLog } from "../store/event-log";
import { DEFAULT_MISSION_BUDGET_CENTS } from "./mission-ledger";
import { identifier } from "./request-validation";

const missionBody = z.strictObject({
  goal: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  briefing_id: identifier.optional(),
  budget_cents: z.number().int().nonnegative().default(DEFAULT_MISSION_BUDGET_CENTS),
});
export const allowedLocalCommands = ["pnpm *", "npm *", "node *"] as const;

const unconfiguredModel: ModelCall = async () => {
  throw new Error("not configured");
};

async function readPlanningContext(path: string) {
  const repo = await git(path, "rev-parse", "--show-toplevel");
  const commit = await git(repo, "rev-parse", "HEAD");
  const [branch, files, rules, lessons, lanes] = await Promise.all([
    tryGit(repo, "symbolic-ref", "--short", "HEAD"),
    tryGit(repo, "ls-tree", "-r", "--name-only", "-z", commit),
    tryGit(repo, "show", `${commit}:.bulletin/rules.md`),
    tryGit(repo, "show", `${commit}:.bulletin/lessons.md`),
    tryGit(repo, "show", `${commit}:.bulletin/lanes.json`),
  ]);
  if (files.code !== 0) throw new Error("could not read tracked files");

  const repoFiles = files.stdout.split("\0").filter(Boolean);
  return {
    repo,
    base: branch.code === 0 ? branch.stdout.trim() : commit,
    repoMap: repoFiles.join("\n"),
    rules: rules.code === 0 ? rules.stdout : "",
    lessons: lessons.code === 0 ? lessons.stdout : "",
    validation: {
      repoFiles,
      lanes: lanes.code === 0 ? LanesConfigSchema.parse(JSON.parse(lanes.stdout)) : DEFAULT_LANES,
      allowedCommands: allowedLocalCommands,
    },
  };
}

export function registerMissionPlanning(app: FastifyInstance, log: EventLog, briefings: BriefingStore, modelCall?: ModelCall): void {
  app.post("/missions", async (request, reply) => {
    const parsed = missionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });

    const { goal, repo: path, briefing_id, budget_cents } = parsed.data;
    const briefing = briefing_id === undefined ? undefined : briefings.get(briefing_id);
    if (briefing_id !== undefined && !briefing) return reply.code(404).send({ error: "Briefing not found" });
    if (briefing?.markdown === null) return reply.code(409).send({ error: "Briefing is incomplete" });
    let context;
    try {
      context = await readPlanningContext(path);
    } catch {
      return reply.code(422).send({ error: "Repository unavailable" });
    }

    const { repo, base, ...input } = context;
    const result = await runGeneral({ ...input, briefing: briefing?.markdown ?? goal }, modelCall ?? unconfiguredModel);
    if (!result.ok) {
      return reply.code(modelCall ? 422 : 503).send({
        error: "Mission planning failed",
        errors: result.errors,
        attempts: result.attempts,
      });
    }

    const mission_id = randomUUID();
    const { attempts } = result;
    const plan = briefing ? { ...result.plan, briefing_version: 1 } : result.plan;
    await log.emit({ mission_id, type: "mission.created", payload: { goal, repo, base, budget_cents } });
    if (briefing) {
      await log.emit({ mission_id, type: "briefing.versioned", payload: { briefing_id, version: 1, markdown: briefing.markdown } });
    }
    await log.emit({ mission_id, type: "plan.proposed", payload: { plan, units: plan.units.length } });
    return reply.code(201).send({ mission_id, plan, attempts });
  });
}
