import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "@bulletin/core";
import { copy, LANE_LABELS, STATUS_LABELS } from "../src/lib/copy";
import { describeEvent } from "../src/lib/war-table";

const root = join(__dirname, "..", "..", "..");

function forbiddenTerms(): string[] {
  const decisions = readFileSync(join(root, "docs", "DECISIONS.md"), "utf8");
  const line = /forbidden-ui-terms:\s*([^`\n]+)/.exec(decisions)?.[1];
  if (!line) throw new Error("docs/DECISIONS.md has no forbidden-ui-terms line");
  return line.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function copyStrings(): string[] {
  const shown: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") shown.push(value);
    else if (typeof value === "function") shown.push(String((value as (...a: unknown[]) => unknown)("x", "y")));
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect([copy, STATUS_LABELS, LANE_LABELS]);
  return shown;
}

function feedStrings(): string[] {
  const payload = { attempt: 2, reason: "a test failed", wave: 2, units: 3, version: 2, cost_cents: 12, kind: "question" };
  return EVENT_TYPES.flatMap((type) => [
    describeEvent({ type, unit_id: "u1", payload }, { u1: "Task" }),
    describeEvent({ type, unit_id: null, payload }, {}),
    describeEvent({ type, unit_id: null, payload: {} }, {}),
  ]);
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** JSX text between tags, plus quoted values of attributes a person can see or hear. */
function literalStrings(source: string): string[] {
  const text = [...source.matchAll(/>\s*([^<>{}]*[A-Za-z][^<>{}]*?)\s*</g)].map((m) => m[1] ?? "");
  const attrs = [...source.matchAll(/\b(?:aria-label|title|alt|placeholder)="([^"]+)"/g)].map((m) => m[1] ?? "");
  return [...text, ...attrs].filter((s) => !/[=;]|=>|&&/.test(s));
}

function literalAppStrings(): string[] {
  return tsxFiles(join(__dirname, "..", "src")).flatMap((file) => literalStrings(readFileSync(file, "utf8")));
}

function offending(strings: string[], terms: string[]): string[] {
  return strings.flatMap((s) => terms.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(s)).map((t) => `${t}: ${s}`));
}

describe("plain-language copy", () => {
  const terms = forbiddenTerms();

  it("reads the term list from docs/DECISIONS.md", () => {
    expect(terms).toContain("mission");
    expect(terms).toContain("lane");
    expect(terms.length).toBeGreaterThan(10);
  });

  it("keeps the terms out of every string in lib/copy.ts", () => {
    const strings = copyStrings();
    expect(strings.length).toBeGreaterThan(80);
    expect(offending(strings, terms)).toEqual([]);
  });

  it("keeps the terms out of every activity-feed sentence, and never shows a raw event name", () => {
    const strings = feedStrings();
    expect(offending(strings, terms)).toEqual([]);
    for (const type of EVENT_TYPES) expect(strings).not.toContain(type);
  });

  it("keeps the terms out of literal text in the pages", () => {
    expect(offending(literalAppStrings(), terms)).toEqual([]);
  });

  it("finds literal text and labelled attributes in page source", () => {
    const source = `<section aria-label="Lane picker"><h2>Mission control</h2>{t.title}<p className="x">{a && b}</p></section>`;
    expect(literalStrings(source)).toEqual(["Mission control", "Lane picker"]);
    expect(offending(literalStrings(source), terms)).toHaveLength(2);
  });

  it("catches a term in a sentence", () => {
    expect(offending(["The mission is done", "Merged once checks pass", "fine text"], ["mission", "merge"])).toHaveLength(2);
  });
});
