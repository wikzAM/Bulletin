import { integrationBranch } from "@bulletin/runners";
import { tryGit } from "@bulletin/runners/git";
import type { FastifyInstance } from "fastify";
import type { EventLog } from "../store/event-log";
import { validateIdParams } from "./request-validation";

export type ReadGit = typeof tryGit;
const objectId = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;

export function registerMissionRules(app: FastifyInstance, log: EventLog, readGit: ReadGit = tryGit): void {
  app.get<{ Params: { id: string } }>("/missions/:id/rules", { preValidation: validateIdParams }, async (request, reply) => {
    const { id } = request.params;
    const created = log.events.find((event) => event.mission_id === id && event.type === "mission.created");
    if (!created) return reply.code(404).send({ error: "Mission not found" });

    const { repo } = created.payload;
    if (typeof repo !== "string" || repo.trim() === "") {
      return reply.code(404).send({ error: "Mission integration branch not found" });
    }
    const branch = integrationBranch(id);
    const tip = await readGit(repo, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`);
    const commit = tip.stdout.trim();
    if (tip.code !== 0 || !objectId.test(commit)) {
      return reply.code(404).send({ error: "Mission integration branch not found" });
    }

    const [rules, lessons] = await Promise.all([
      readGit(repo, "show", `${commit}:.bulletin/rules.md`),
      readGit(repo, "show", `${commit}:.bulletin/lessons.md`),
    ]);
    return {
      mission_id: id,
      branch,
      rules: rules.code === 0 ? rules.stdout : null,
      lessons: lessons.code === 0 ? lessons.stdout : null,
    };
  });
}
