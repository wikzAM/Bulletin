import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { copy } from "../lib/copy";
import { toFlowGraph } from "../lib/flow-layout";
import type { PlannedUnit } from "../lib/types";
import type { UnitCard } from "../lib/war-table";
import { UnitFlowNode } from "./UnitFlowNode";

const nodeTypes: NodeTypes = { unit: UnitFlowNode };

function PlanFlowInner({ units, cards }: { units: PlannedUnit[]; cards: Record<string, UnitCard> }) {
  const { nodes, edges } = useMemo(() => {
    const g = toFlowGraph(units, cards);
    return {
      nodes: g.nodes,
      edges: g.edges.map((e) => ({
        ...e,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--muted)" },
        style: { stroke: "var(--border)" },
      })),
    };
  }, [units, cards]);

  if (units.length === 0) {
    return <p className="text-[var(--muted)]">{copy.missionPage.tasksEmpty}</p>;
  }

  return (
    <div className="plan-flow" style={{ height: 360, border: "1px solid var(--border)", borderRadius: 8 }} role="img" aria-label={copy.missionPage.graph.summary}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={{} as EdgeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="var(--border)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

/** Spec war table v0: React Flow nodes in wave columns, fog on not-started tasks. */
export function PlanFlow(props: { units: PlannedUnit[]; cards?: Record<string, UnitCard> }) {
  return (
    <ReactFlowProvider>
      <PlanFlowInner units={props.units} cards={props.cards ?? {}} />
    </ReactFlowProvider>
  );
}
