import type { UnitStatus } from "@bulletin/core";
import type { Edge, Node } from "@xyflow/react";
import { layoutGraph } from "./graph-layout";
import type { PlannedUnit } from "./types";
import type { UnitCard } from "./war-table";

export type FlowUnitData = {
  title: string;
  status: UnitStatus;
  label: string;
  fog: boolean;
};

/** Map plan units + live card status into React Flow nodes (wave columns) and dependency edges. */
export function toFlowGraph(
  units: PlannedUnit[],
  cards: Record<string, UnitCard> = {},
): { nodes: Node<FlowUnitData>[]; edges: Edge[] } {
  const layout = layoutGraph(units);
  const nodes: Node<FlowUnitData>[] = layout.nodes.map((n) => {
    const card = cards[n.id];
    const status = card?.status ?? "pending";
    return {
      id: n.id,
      position: { x: n.x, y: n.y },
      data: {
        title: n.title,
        label: n.label,
        status,
        fog: status === "pending",
      },
      type: "unit",
      style: { width: n.width, height: n.height },
    };
  });

  const byId = new Map(units.map((u) => [u.id, u]));
  const edges: Edge[] = layout.edges.map((e) => {
    const fromTitle = byId.get(e.from)?.title ?? e.from;
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      // PlannedUnit.needs is ids only; hover text names the upstream task until reads land in the UI model.
      label: fromTitle,
      labelStyle: { fontSize: 10, fill: "var(--muted)" },
    };
  });

  return { nodes, edges };
}
