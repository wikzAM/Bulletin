import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildServer } from "../server";
import { JsonlEventLog } from "../store/jsonl-event-log";
import { SqliteEventLog } from "../store/sqlite-event-log";

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
      if (method) operations.push(`${method} ${ancestors.join("")}`);
    }
  }
  return operations.sort();
}

async function checkOperations(app: ReturnType<typeof buildServer>): Promise<string> {
  try {
    const docs = await readFile(new URL("../../../../docs/API.md", import.meta.url), "utf8");
    const headings = [...docs.matchAll(/^## `([A-Z]+) (\/[^`]+)`$/gm)];
    const documented = headings.flatMap(([, method, path]) => {
      const route = path?.split("?")[0];
      const operation = `${method} ${route}`;
      return method === "GET" && route !== "/missions/:id/events" ? [operation, `HEAD ${route}`] : [operation];
    }).sort();

    await app.ready();
    expect(listedOperations(app.printRoutes({ commonPrefix: false }))).toEqual(documented);
    return docs;
  } finally {
    await app.close();
  }
}

it("documents every registered API operation and lists only registered operations", async () => {
  const docs = await checkOperations(buildServer());
  const errors = docs.split(/^## /m).find((section) => /^Errors\r?\n/.test(section));
  const codes = [...(errors ?? "").matchAll(/^- `(\d{3}) [^`]+`/gm)].map(([, status]) => Number(status));
  expect(codes).toEqual([400, 401, 404, 409, 413, 415, 422, 500, 502, 503]);
});

it.each([
  { name: "SQLite", filename: "events.sqlite", open: SqliteEventLog.open },
  { name: "JSONL", filename: "events.jsonl", open: JsonlEventLog.open },
])("covers the same operations with the $name log and documents the runnable API", async ({ filename, open }) => {
  const directory = await mkdtemp(join(tmpdir(), "bulletin-api-contract-"));
  const path = join(directory, filename);
  const log = await open(path);
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

it("links the desktop and HTTP references and documents the mission stream on each transport", async () => {
  const [api, sidecar] = await Promise.all([
    readFile(new URL("../../../../docs/API.md", import.meta.url), "utf8"),
    readFile(new URL("../../../../docs/SIDECAR.md", import.meta.url), "utf8"),
  ]);
  expect(api).toContain("[Sidecar protocol](SIDECAR.md)");
  expect(sidecar).toContain("[API reference](API.md)");
  expect(api).toMatch(/^## `GET \/missions\/:id\/events(?:\?[^`]*)?`$/m);
  expect(sidecar).toContain("`GET /missions/:id/events`");
  expect(sidecar).toMatch(/^## `subscribe`$/m);
});
