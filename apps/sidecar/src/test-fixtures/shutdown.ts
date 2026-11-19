import { join } from "node:path";
import { appDataDirectory } from "../../../api/src/platform/paths";
import { buildServer } from "../../../api/src/server";
import { SqliteEventLog } from "../../../api/src/store/sqlite-event-log";
import { runSidecar } from "../run-sidecar";

async function main() {
  const log = await SqliteEventLog.open(join(appDataDirectory(), "events.sqlite"));
  const missionShutdown = new AbortController();
  const mission_id = "demo";
  const unit_id = "seed";
  await log.emit({ mission_id, type: "mission.created", payload: { repo: "fixture", base: "main" } });
  await log.emit({ mission_id, type: "plan.proposed", payload: {
    plan: { briefing_version: 1, units: [{ id: unit_id, title: "Seed", task: "Seed data", files: ["seed.ts"] }] },
  } });
  const app = buildServer(log, {
    missionShutdown,
    async startMission({ events, signal }) {
      const keepAlive = setInterval(() => {}, 1000);
      try {
        const aborted = new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await events.emit({ mission_id, unit_id, type: "unit.started" });
        await aborted;
        await events.emit({ mission_id, unit_id, type: "attempt.ended", payload: { result: "cancelled" } });
        if (process.argv[2] === "hang") await new Promise<void>(() => {});
        await events.emit({ mission_id, type: "mission.finished", payload: { stopped: true } });
      } finally {
        clearInterval(keepAlive);
      }
    },
  });
  app.addHook("onClose", () => log.close());
  await runSidecar({ app, log, stopMissions: () => missionShutdown.abort() });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
