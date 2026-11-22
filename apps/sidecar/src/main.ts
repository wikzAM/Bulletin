import { createApplication } from "../../api/src/application";
import { appDataDirectory } from "../../api/src/platform/paths";
import { SettingsStore } from "../../api/src/platform/settings";
import { UnsupportedSqliteSchemaError } from "../../api/src/store/sqlite-event-log";
import { applyProviderSettings } from "./provider-settings";
import { runSidecar } from "./run-sidecar";

async function main() {
  applyProviderSettings(process.env, await new SettingsStore(appDataDirectory()).get());
  await runSidecar(await createApplication());
}

main().catch((error: unknown) => {
  console.error(error instanceof UnsupportedSqliteSchemaError ? error.message : "Sidecar failed to start or shut down");
  process.exitCode = 1;
});
