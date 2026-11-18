import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadModelsConfig, loadPricesConfig } from "@bulletin/core";
import { modelCallFactory } from "./general";
import { appDataDirectory } from "./platform/paths";
import { createGeneralCall } from "./routes/general-model";
import { DEFAULT_UNIT_ALLOWANCE_CENTS } from "./routes/mission-ledger";
import { allowedLocalCommands } from "./routes/mission-planning";
import { MemoryQuestionStore } from "./routes/questions-store";
import { createRunnerFactory, missingManagedVariableNames } from "./routes/runner-selection";
import { buildServer } from "./server";
import { JsonlBriefingStore } from "./store/briefing-store";
import { recoverInterruptedMissions } from "./store/mission-recovery";
import { openEventLog } from "./store/open-event-log";

export async function createApplication() {
  const resourceDirectory = process.env.BULLETIN_RESOURCE_DIR?.trim();
  const root = resourceDirectory ? resolve(resourceDirectory) : resolve(import.meta.dirname, "../../..");
  if (process.env.BULLETIN_RUNNER === "managed") {
    const missing = missingManagedVariableNames(
      (name) => Boolean(process.env[name]?.trim()),
      existsSync(join(root, ".bulletin-local.json")),
    );
    if (missing.length > 0) console.warn(`Managed runner is missing environment variables: ${missing.join(", ")}`);
  }
  const createRunner = createRunnerFactory({
    BULLETIN_RUNNER: process.env.BULLETIN_RUNNER,
    BULLETIN_SANDBOX_REPO: process.env.BULLETIN_SANDBOX_REPO,
  }, root);
  const appData = appDataDirectory();
  const defaultScratch = resourceDirectory ? join(appData, "scratch") : ".bulletin-scratch";
  const dataDirectory = resolve(root, process.env.BULLETIN_SCRATCH_DIR ?? defaultScratch, "api");
  const models = loadModelsConfig(join(root, "config/models.json"));
  const prices = loadPricesConfig(join(root, "config/prices.json"));
  const general = models.roles.general;
  if (!general) throw new Error("The General model is missing from config/models.json");
  const createCall = modelCallFactory(process.env, { bedrockModels: models.providers?.bedrock?.models });
  const modelCall = createGeneralCall(general, createCall);
  const interviewer = models.roles.interviewer;
  const answerer = models.roles.answerer;

  async function engineOptions({ missionId, repo }: { missionId: string; repo: string }) {
    const scratchDir = join(dataDirectory, missionId);
    return {
      scratchDir,
      runner: await createRunner(repo, scratchDir),
      prices,
      tiers: models.tiers,
      allowedCommands: allowedLocalCommands,
      unitAllowanceCents: DEFAULT_UNIT_ALLOWANCE_CENTS,
    };
  }

  const log = await openEventLog(appData, join(dataDirectory, "events.jsonl"), process.env.BULLETIN_EVENT_STORE);
  const briefingStore = await JsonlBriefingStore.open(join(dataDirectory, "briefings.jsonl")).catch(async (error: unknown) => {
    await log.close();
    throw error;
  });
  const app = buildServer(log, {
    answererCall: answerer ? createCall(answerer.model) : undefined,
    briefingStore,
    config: { models, prices },
    interviewerCall: interviewer ? createCall(interviewer.model) : undefined,
    modelCall,
    questionStore: new MemoryQuestionStore(),
    async startMission(mission) {
      const [{ runMission }, options] = await Promise.all([
        import("./orchestrator/run-mission"),
        engineOptions(mission),
      ]);
      return runMission({ ...mission, ...options });
    },
    async resolveHeldMission(held) {
      const [{ resolveHeld }, options] = await Promise.all([
        import("./orchestrator/resolve-held"),
        engineOptions(held),
      ]);
      return (await resolveHeld({ ...held, ...options })).outcome;
    },
  });
  app.addHook("onClose", async () => {
    await Promise.all([log.close(), briefingStore.close()]);
  });

  try {
    await recoverInterruptedMissions(log);
  } catch (error) {
    await app.close();
    throw error;
  }
  return { app, log };
}
