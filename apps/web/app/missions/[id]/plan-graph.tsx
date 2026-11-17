import { copy } from "../../../lib/copy";
import { describeNeeds, layoutGraph } from "../../../lib/graph-layout";
import type { PlannedUnit } from "../../../lib/types";

const g = copy.missionPage.graph;

/** The plan as a drawing: one column per batch, arrows from each task to the tasks that wait for it. */
export function PlanGraph({ units }: { units: PlannedUnit[] }) {
  const layout = layoutGraph(units);
  if (layout.nodes.length === 0) return null;
  const sentences = describeNeeds(units);

  return (
    <details className="plan-graph">
      <summary>{g.summary}</summary>
      <p className="muted">{g.label}</p>
      <div className="plan-graph-scroll">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-labelledby="plan-graph-title plan-graph-desc"
        >
          <title id="plan-graph-title">{g.summary}</title>
          <desc id="plan-graph-desc">{sentences.length > 0 ? sentences.join(" ") : g.none}</desc>
          <defs>
            <marker id="plan-graph-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className="plan-graph-arrowhead" />
            </marker>
          </defs>
          {layout.edges.map((e) => {
            const bend = Math.max(24, (e.x2 - e.x1) / 2);
            return (
              <path
                key={`${e.from}-${e.to}`}
                className="plan-graph-edge"
                d={`M${e.x1},${e.y1} C${e.x1 + bend},${e.y1} ${e.x2 - bend},${e.y2} ${e.x2},${e.y2}`}
                markerEnd="url(#plan-graph-arrow)"
              />
            );
          })}
          {layout.nodes.map((n) => (
            <g key={n.id} className="plan-graph-node">
              <title>{n.title}</title>
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={6} />
              <text x={n.x + 10} y={n.y + n.height / 2} dominantBaseline="middle">
                {n.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {sentences.length === 0 ? (
        <p className="muted">{g.none}</p>
      ) : (
        <ul className="plan-graph-words">
          {sentences.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
