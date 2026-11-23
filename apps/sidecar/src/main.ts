import { createApplication } from "../../api/src/application";
import { appDataDirectory } from "../../api/src/platform/paths";
import { SettingsStore } from "../../api/src/platform/settings";
import { UnsupportedSqliteSchemaError } from "../../api/src/store/sqlite-event-log";
import { SidecarDiagnostics } from "./diagnostics";
import { applyProviderSettings } from "./provider-settings";
import { runSidecar } from "./run-sidecar";

const dataDirectory = appDataDirectory();
const diagnostics = new SidecarDiagnostics(dataDirectory);

async function main() {
  applyProviderSettings(process.env, await new SettingsStore(dataDirectory).get());
  await runSidecar(await createApplication(), diagnostics);
}

main().catch((error: unknown) => {
  const newerSchema = error instanceof UnsupportedSqliteSchemaError;
  diagnostics.write(newerSchema ? "schemaTooNew" : "failed");
  console.error(newerSchema ? error.message : "Sidecar failed to start or shut down");
  process.exitCode = 1;
});
