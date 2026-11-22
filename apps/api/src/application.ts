import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadModelsConfig, loadPricesConfig } from "@bulletin/core";
import { modelCallFactory, type ModelCall } from "./general";
import { appDataDirectory } from "./platform/paths";
import { SettingsStore } from "./platform/settings";
import { createGeneralCall } from "./routes/general-model";
import { DEFAULT_MISSION_BUDGET_CENTS, DEFAULT_UNIT_ALLOWANCE_CENTS, readMissionBudget } from "./routes/mission-ledger";
import { allowedLocalCommands } from "./routes/mission-planning";
import { QuestionWorkflow } from "./routes/question-workflow";
import { MemoryQuestionStore } from "./routes/questions-store";
import { createRunnerFactory, missingManagedVariableNames } from "./routes/runner-selection";
import { buildServer } from "./server";
import { JsonlBriefingStore } from "./store/briefing-store";
import { recoverInterruptedMissions } from "./store/mission-recovery";
import { openEventLog } from "./store/open-event-log";

interface ApplicationOptions {
  modelCall?: ModelCall;
  interviewerCall?: ModelCall;
  answererCall?: ModelCall;
  createRunner?: ReturnType<typeof createRunnerFactory>;
  testCommand?: string;
}

export async function createApplication(options: ApplicationOptions = {}) {
  const resourceDirectory = process.env.BULLETIN_RESOURCE_DIR?.trim();
  const root = resourceDirectory ? resolve(resourceDirectory) : resolve(import.meta.dirname, "../../..");
  if (process.env.BULLETIN_RUNNER === "managed") {
    const missing = missingManagedVariableNames(
      (name) => Boolean(process.env[name]?.trim()),
      existsSync(join(root, ".bulletin-local.json")),
    );
    if (missing.length > 0) console.warn(`Managed runner is missing environment variables: ${missing.join(", ")}`);
  }
  const createRunner = options.createRunner ?? createRunnerFactory({
    BULLETIN_RUNNER: process.env.BULLETIN_RUNNER,
    BULLETIN_SANDBOX_REPO: process.env.BULLETIN_SANDBOX_REPO,
  }, root);
  const appData = appDataDirectory();
  const settings = new SettingsStore(appData);
  const defaultScratch = resourceDirectory ? join(appData, "scratch") : ".bulletin-scratch";
  const dataDirectory = resolve(root, process.env.BULLETIN_SCRATCH_DIR ?? defaultScratch, "api");
  const models = loadModelsConfig(join(root, "config/models.json"));
  const prices = loadPricesConfig(join(root, "config/prices.json"));
  const general = models.roles.general;
  if (!general) throw new Error("The General model is missing from config/models.json");
  const createCall = modelCallFactory(process.env, { bedrockModels: models.providers?.bedrock?.models });
  const modelCall = options.modelCall ?? createGeneralCall(general, createCall);
  const interviewer = models.roles.interviewer;
  const answerer = models.roles.answerer;
  const answererCall = options.answererCall ?? (answerer ? createCall(answerer.model) : undefined);

  const log = await openEventLog(appData, join(dataDirectory, "events.jsonl"), process.env.BULLETIN_EVENT_STORE);
  const briefingStore = await JsonlBriefingStore.open(join(dataDirectory, "briefings.jsonl")).catch(async (error: unknown) => {
    await log.close();
    throw error;
  });
  const questionWorkflow = new QuestionWorkflow(log, new MemoryQuestionStore());

  async function engineOptions({ missionId, repo, unitAllowanceCents }: {
    missionId: string; repo: string; unitAllowanceCents?: number;
  }) {
    const scratchDir = join(dataDirectory, missionId);
    const { max_parallel_stations } = await settings.get();
    const runner = process.env.BULLETIN_RUNNER === "sdk"
      ? await createRunner(repo, scratchDir, { stationTools: await questionWorkflow.stationTools(answererCall) })
      : await createRunner(repo, scratchDir);
    return {
      scratchDir, runner, prices, tiers: models.tiers, allowedCommands: allowedLocalCommands,
      testCommand: options.testCommand,
      parallel: typeof max_parallel_stations === "number" ? max_parallel_stations : undefined,
      unitAllowanceCents: unitAllowanceCents ?? DEFAULT_UNIT_ALLOWANCE_CENTS,
    };
  }

  const missionShutdown = new AbortController();
  const app = buildServer(log, {
    answererCall,
    briefingStore,
    config: { models, prices },
    interviewerCall: options.interviewerCall ?? (interviewer ? createCall(interviewer.model) : undefined),
    modelCall,
    missionShutdown,
    questionWorkflow,
    async readBudgetDefaults() {
      const stored = await settings.get();
      return {
        budgetCents: readMissionBudget(stored.default_budget_cents) ?? DEFAULT_MISSION_BUDGET_CENTS,
        unitAllowanceCents: readMissionBudget(stored.unit_allowance_cents) ?? DEFAULT_UNIT_ALLOWANCE_CENTS,
      };
    },
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
      return (await resolveHeld({ ...held, ...options, signal: missionShutdown.signal })).outcome;
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
  return { app, log, stopMissions: () => missionShutdown.abort() };
}
