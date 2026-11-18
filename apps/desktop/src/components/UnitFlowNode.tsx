import { Handle, Position, type NodeProps } from "@xyflow/react";
import { STATUS_LABELS } from "../lib/copy";
import type { FlowUnitData } from "../lib/flow-layout";

const STATUS_ICON: Record<string, string> = {
  pending: "·",
  running: "▸",
  green: "✓",
  red: "↩",
  held: "⏸",
  failed: "✕",
  blocked: "⊘",
  merged: "✓",
};

/** One task on the war table: status icon + text + colour; fog when not started. */
export function UnitFlowNode({ data }: NodeProps & { data: FlowUnitData }) {
  const status = STATUS_LABELS[data.status] ?? { label: data.status, icon: STATUS_ICON[data.status] ?? "·" };
  return (
    <div
      className={`unit-flow-node status-${data.status}${data.fog ? " fog" : ""}`}
      title={data.title}
      style={{
        width: "100%",
        height: "100%",
        padding: "0.4rem 0.55rem",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--card)",
        color: "var(--fg)",
        fontSize: 12,
        lineHeight: 1.25,
        opacity: data.fog ? 0.45 : 1,
        filter: data.fog ? "grayscale(0.4)" : undefined,
        boxShadow: data.fog ? "inset 0 0 0 999px color-mix(in srgb, var(--muted) 18%, transparent)" : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div style={{ display: "flex", gap: "0.35rem", alignItems: "baseline" }}>
        <span aria-hidden="true">{status.icon}</span>
        <strong style={{ fontWeight: 600 }}>{data.label}</strong>
      </div>
      <div className="muted" style={{ color: "var(--muted)", marginTop: 2 }}>
        {status.label}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
