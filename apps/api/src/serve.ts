import { join, resolve } from "node:path";
import { loadModelsConfig, loadPricesConfig } from "@bulletin/core";
import { ClaudeCodeRunner } from "@bulletin/runners/claude-code-runner";
import { claudeModelCall, withFallback } from "./general";
import { runMission } from "./orchestrator/run-mission";
import { allowedLocalCommands } from "./routes/mission-planning";
import { MemoryQuestionStore } from "./routes/questions-store";
import { buildServer } from "./server";
import { JsonlBriefingStore } from "./store/briefing-store";
import { JsonlEventLog } from "./store/jsonl-event-log";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535");

  const root = resolve(import.meta.dirname, "../../..");
  const dataDirectory = resolve(root, process.env.BULLETIN_SCRATCH_DIR ?? ".bulletin-scratch", "api");
  const models = loadModelsConfig(join(root, "config/models.json"));
  const prices = loadPricesConfig(join(root, "config/prices.json"));
  const general = models.roles.general;
  if (!general) throw new Error("The General model is missing from config/models.json");
  const primary = claudeModelCall(general.model);
  const modelCall = general.fallback ? withFallback(primary, claudeModelCall(general.fallback)) : primary;
  const interviewer = models.roles.interviewer;

  const log = await JsonlEventLog.open(join(dataDirectory, "events.jsonl"));
  const briefingStore = await JsonlBriefingStore.open(join(dataDirectory, "briefings.jsonl")).catch(async (error: unknown) => {
    await log.close();
    throw error;
  });
  const app = buildServer(log, {
    briefingStore,
    interviewerCall: interviewer ? claudeModelCall(interviewer.model) : undefined,
    modelCall,
    questionStore: new MemoryQuestionStore(),
    startMission(mission) {
      const scratchDir = join(dataDirectory, mission.missionId);
      return runMission({
        ...mission,
        scratchDir,
        runner: new ClaudeCodeRunner(mission.repo, scratchDir),
        prices,
        tiers: models.tiers,
        allowedCommands: allowedLocalCommands,
        unitAllowanceCents: 200,
      });
    },
  });
  app.addHook("onClose", async () => {
    await Promise.all([log.close(), briefingStore.close()]);
  });

  try {
    const address = await app.listen({ port, host: "127.0.0.1" });
    console.log(`api listening on ${address}`);
  } catch (error) {
    await app.close();
    throw error;
  }

  function stop() {
    void app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
