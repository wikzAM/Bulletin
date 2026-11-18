import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

/** The body of the first `selector {` block after `from`, matching braces. */
function block(source: string, start: number): string {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

function variables(body: string): string[] {
  return [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!).sort();
}

const lightStart = css.indexOf(":root");
const light = block(css, lightStart);
const darkMedia = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = darkMedia === -1 ? "" : block(block(css, darkMedia), 0);

describe("themes", () => {
  it("has a dark theme that follows the system setting", () => {
    expect(darkMedia).toBeGreaterThan(-1);
    expect(light).toContain("color-scheme: light");
    expect(dark).toContain("color-scheme: dark");
  });

  it("defines the same color variables in light and dark", () => {
    expect(variables(light).length).toBeGreaterThan(10);
    expect(variables(dark)).toEqual(variables(light));
  });

  it("uses no raw hex colors outside the theme blocks", () => {
    const outside = css.replace(light, "").replace(dark, "");
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
});
