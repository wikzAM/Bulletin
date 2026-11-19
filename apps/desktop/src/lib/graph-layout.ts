import { copy } from "./copy";
import type { PlannedUnit } from "./types";

/** Sizes in SVG user units. */
export const GRAPH = { nodeWidth: 180, nodeHeight: 58, gapX: 64, gapY: 18, pad: 8, maxLabel: 24 } as const;

export interface GraphNode {
  id: string;
  title: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

function shorten(title: string): string {
  return title.length <= GRAPH.maxLabel ? title : `${title.slice(0, GRAPH.maxLabel - 1).trimEnd()}…`;
}

/** One column per batch, left to right; plan order top to bottom. Batch 0 (not in the plan) goes last. */
export function layoutGraph(units: PlannedUnit[]): GraphLayout {
  if (units.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };
  const rank = (wave: number) => (wave > 0 ? wave : Number.MAX_SAFE_INTEGER);
  const waves = [...new Set(units.map((u) => u.wave))].sort((a, b) => rank(a) - rank(b));
  const { nodeWidth, nodeHeight, gapX, gapY, pad } = GRAPH;

  const nodes: GraphNode[] = [];
  let rows = 0;
  waves.forEach((wave, col) => {
    const column = units.filter((u) => u.wave === wave);
    rows = Math.max(rows, column.length);
    column.forEach((u, row) => {
      nodes.push({
        id: u.id,
        title: u.title,
        label: shorten(u.title),
        x: pad + col * (nodeWidth + gapX),
        y: pad + row * (nodeHeight + gapY),
        width: nodeWidth,
        height: nodeHeight,
      });
    });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = units.flatMap((u) => {
    const to = byId.get(u.id);
    if (!to) return [];
    return u.needs.flatMap((need) => {
      const from = byId.get(need);
      if (!from) return [];
      return [{ from: from.id, to: to.id, x1: from.x + from.width, y1: from.y + from.height / 2, x2: to.x, y2: to.y + to.height / 2 }];
    });
  });

  return {
    nodes,
    edges,
    width: pad * 2 + waves.length * nodeWidth + (waves.length - 1) * gapX,
    height: pad * 2 + rows * nodeHeight + (rows - 1) * gapY,
  };
}

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}${copy.missionPage.graph.and}${items[items.length - 1]}`;
}

/** The graph in words, for screen readers and small screens. */
export function describeNeeds(units: PlannedUnit[]): string[] {
  const titles = new Map(units.map((u) => [u.id, u.title]));
  return units.flatMap((u) => {
    const needs = u.needs.flatMap((n) => titles.get(n) ?? []);
    return needs.length === 0 ? [] : [copy.missionPage.graph.waitsFor(u.title, joinWords(needs))];
  });
}