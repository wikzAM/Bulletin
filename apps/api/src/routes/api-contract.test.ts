import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { buildServer } from "../server";

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

it("documents every registered API operation and lists only registered operations", async () => {
  const app = buildServer();
  try {
    const docs = await readFile(new URL("../../../../docs/API.md", import.meta.url), "utf8");
    const headings = [...docs.matchAll(/^## `([A-Z]+) (\/[^`]+)`$/gm)];
    const documented = headings.map(([, method, path]) => `${method} ${path?.split("?")[0]}`).sort();

    await app.ready();
    expect(listedOperations(app.printRoutes({ commonPrefix: false }))).toEqual(documented);
  } finally {
    await app.close();
  }
});
