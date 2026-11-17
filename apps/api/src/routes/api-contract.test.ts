import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildServer } from "../server";
import { JsonlEventLog } from "../store/jsonl-event-log";

function listedOperations(routeTree: string): string[] {
  const ancestors: string[] = [];
  const operations: string[] = [];
  for (const line of routeTree.split("\n")) {
    const entry = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?$/.exec(line);
    if (!entry) continue;

    const [, indent = "", path = "", methods = ""] = entry;
    const depth = indent.length / 4;
    ancestors.splice(depth, ancestors.length, path);
    for (const method of methods.split(", ")) {
      if (method && method !== "HEAD") operations.push(`${method} ${ancestors.join("")}`);
    }
  }
  return operations.sort();
}

async function checkOperations(app: ReturnType<typeof buildServer>): Promise<string> {
  try {
    const docs = await readFile(new URL("../../../../docs/API.md", import.meta.url), "utf8");
    const headings = [...docs.matchAll(/^## `([A-Z]+) (\/[^`]+)`$/gm)];
    const documented = headings.map(([, method, path]) => `${method} ${path?.split("?")[0]}`).sort();

    await app.ready();
    expect(listedOperations(app.printRoutes({ commonPrefix: false }))).toEqual(documented);
    return docs;
  } finally {
    await app.close();
  }
}

it("documents every registered API operation and lists only registered operations", async () => {
  await checkOperations(buildServer());
});

it("covers the same operations with the JSONL log and documents the runnable API", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-api-contract-"));
  const path = join(directory, "events.jsonl");
  const log = await JsonlEventLog.open(path);
  try {
    const docs = await checkOperations(buildServer(log));
    expect(docs).toMatch(/^## Running the API$/m);
    expect(docs).toContain("pnpm --filter @bulletin/api exec tsx src/serve.ts");
  } finally {
    await log.close();
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
