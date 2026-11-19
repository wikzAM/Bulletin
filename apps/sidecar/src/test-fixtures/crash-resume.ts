import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { StubRunner } from "../../../../packages/runners/src/stub-runner";
import { createApplication } from "../../../api/src/application";
import { runSidecar } from "../run-sidecar";

const marker = join(process.env.BULLETIN_SCRATCH_DIR!, "crash-ready");
const crashAt = process.argv[2];

async function main() {
  const application = await createApplication({
    async modelCall() {
      return JSON.stringify({ briefing_version: 1, units: [
        { id: "first", title: "Set the first value", task: "Set the first value", files: ["first.txt"], estimate: { input_tokens: 1000, output_tokens: 100 } },
        { id: "second", title: "Set the second value", task: "Set the second value", files: ["second.txt"], estimate: { input_tokens: 1000, output_tokens: 100 },
          needs: [{ unit: "first", reads: "the value in first.txt" }] },
      ] });
    },
    async createRunner(repo, scratchDir) {
      return new StubRunner(repo, join(scratchDir, "stations"), ({ unit }) => {
        const interrupted = unit.id === "second" && crashAt === "attempt";
        if (interrupted) writeFileSync(marker, "ready");
        return { files: { [unit.files[0]!]: "1\n" }, ...(interrupted ? { delayMs: 90_000 } : {}) };
      });
    },
    testCommand: "node --version",
  });
  if (crashAt === "merge") {
    const emit = application.log.emit.bind(application.log);
    application.log.emit = async (event) => {
      if (event.type === "unit.merged" && event.unit_id === "first") {
        writeFileSync(marker, "ready");
        await new Promise<void>(() => {});
      }
      return emit(event);
    };
  }
  await runSidecar(application);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
