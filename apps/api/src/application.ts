import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadModelsConfig, loadPricesConfig } from "@bulletin/core";
import { claudeModelCall } from "./general";
import { runMission } from "./orchestrator/run-mission";
import { createGeneralCall } from "./routes/general-model";
import { DEFAULT_UNIT_ALLOWANCE_CENTS } from "./routes/mission-ledger";
import { allowedLocalCommands } from "./routes/mission-planning";
import { MemoryQuestionStore } from "./routes/questions-store";
import { createRunnerFactory, missingManagedVariableNames } from "./routes/runner-selection";
import { buildServer } from "./server";
import { JsonlBriefingStore } from "./store/briefing-store";
import { JsonlEventLog } from "./store/jsonl-event-log";
import { recoverInterruptedMissions } from "./store/mission-recovery";

export async function createApplication() {
  const root = resolve(import.meta.dirname, "../../..");
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
  const dataDirectory = resolve(root, process.env.BULLETIN_SCRATCH_DIR ?? ".bulletin-scratch", "api");
  const models = loadModelsConfig(join(root, "config/models.json"));
  const prices = loadPricesConfig(join(root, "config/prices.json"));
  const general = models.roles.general;
  if (!general) throw new Error("The General model is missing from config/models.json");
  const modelCall = createGeneralCall(general);
  const interviewer = models.roles.interviewer;
  const answerer = models.roles.answerer;

  const log = await JsonlEventLog.open(join(dataDirectory, "events.jsonl"));
  const briefingStore = await JsonlBriefingStore.open(join(dataDirectory, "briefings.jsonl")).catch(async (error: unknown) => {
    await log.close();
    throw error;
  });
  const app = buildServer(log, {
    answererCall: answerer ? claudeModelCall(answerer.model) : undefined,
    briefingStore,
    config: { models, prices },
    interviewerCall: interviewer ? claudeModelCall(interviewer.model) : undefined,
    modelCall,
    questionStore: new MemoryQuestionStore(),
    startMission(mission) {
      const scratchDir = join(dataDirectory, mission.missionId);
      return runMission({
        ...mission,
        scratchDir,
        runner: createRunner(mission.repo, scratchDir),
        prices,
        tiers: models.tiers,
        allowedCommands: allowedLocalCommands,
        unitAllowanceCents: DEFAULT_UNIT_ALLOWANCE_CENTS,
      });
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
