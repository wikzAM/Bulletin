import { join } from "node:path";
import { StubRunner } from "../../../../packages/runners/src/stub-runner";
import { createApplication } from "../../../api/src/application";
import { runSidecar } from "../run-sidecar";

const briefing = [
  "# Briefing: Set the fixture value", "## Goal", "Set the value to 1.", "## Users", "Desktop test users.",
  "## Features", "Write the requested value.", "## Constraints", "Use the local fixture repository.",
  "## Out of scope", "Publishing the work.", "## Decisions log",
].join("\n");

createApplication({
  async interviewerCall(_system, input) {
    const { answers } = JSON.parse(input) as { answers: unknown[] };
    return JSON.stringify(answers.length === 0 ? { question: "What value should the file contain?" } : { markdown: briefing });
  },
  async modelCall(_system, input) {
    if (!input.includes("value.txt") || !input.includes("Set the value to 1.")) throw new Error("The General needs the fixture Briefing and repository map");
    return JSON.stringify({ briefing_version: 1, units: [{
      id: "write-value", title: "Write the value", task: "Write 1 to value.txt", files: ["value.txt"],
      acceptance: ["node check.mjs"], estimate: { input_tokens: 1000, output_tokens: 100 },
    }] });
  },
  async answererCall() { return "SILENT"; },
  async createRunner(repo, scratchDir) {
    return new StubRunner(repo, join(scratchDir, "stations"), () => ({ files: { "value.txt": "1\n" } }));
  },
  testCommand: "node check.mjs",
}).then(runSidecar).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Desktop fixture failed");
  process.exitCode = 1;
});
