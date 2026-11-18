import { createApplication } from "../../api/src/application";
import { runSidecar } from "./run-sidecar";

createApplication().then(runSidecar).catch(() => {
  console.error("Sidecar failed to start or shut down");
  process.exitCode = 1;
});
