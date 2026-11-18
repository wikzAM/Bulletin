import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildSidecar } from "../../../../scripts/build-sidecar.mjs";

const repo = resolve(import.meta.dirname, "../../../..");
const output = join(repo, ".workbench", "desktop-flow");
await mkdir(output, { recursive: true });
const prefix = join(output, "input-");
const work = await mkdtemp(prefix);
if (!resolve(work).startsWith(prefix)) throw new Error("Fixture build directory is outside its expected path");
try {
  const entryDirectory = join(work, "apps", "sidecar", "src");
  await mkdir(entryDirectory, { recursive: true });
  const fixture = join(import.meta.dirname, "desktop-flow.ts").replaceAll("\\", "/");
  await writeFile(join(entryDirectory, "main.ts"), `import ${JSON.stringify(fixture)};\n`);
  const { executable } = await buildSidecar({ root: work, outDir: output, workDir: join(work, "build") });
  console.log(executable);
} finally {
  await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}
