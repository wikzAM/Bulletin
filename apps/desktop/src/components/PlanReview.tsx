import { useState } from "react";
import { copy, LANE_LABELS } from "../lib/copy";
import { formatCents } from "../lib/format";
import { canRequestRevision, fareRangeCents, formatFareRange } from "../lib/plan-review";
import type { PlannedUnit } from "../lib/types";
import { PlanFlow } from "./PlanFlow";

export function PlanReview({
  units,
  estimateCents,
  revisionsUsed,
  onRevise,
  revising,
}: {
  units: PlannedUnit[];
  estimateCents: number;
  revisionsUsed: number;
  onRevise: (comment: string) => Promise<void>;
  revising?: boolean;
}) {
  const t = copy.planReview;
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const range = fareRangeCents(estimateCents);
  const mayRevise = canRequestRevision(revisionsUsed);

  const send = async () => {
    if (!comment.trim()) {
      setError(t.commentEmpty);
      return;
    }
    setError(null);
    await onRevise(comment.trim());
    setComment("");
  };

  return (
    <section className="plan-review" aria-labelledby="plan-review-title">
      <h2 id="plan-review-title">{t.title}</h2>
      <PlanFlow units={units} />
      <p>
        <strong>{t.fare}:</strong> {formatFareRange(range, formatCents)}
      </p>
      <p className="muted">{t.fareHint}</p>
      <h3>{t.lanes}</h3>
      <ul className="plan-lanes">
        {units.map((u) => (
          <li key={u.id}>
            <strong>{u.title}</strong> — {LANE_LABELS[u.lane]}
          </li>
        ))}
      </ul>
      {mayRevise ? (
        <div className="plan-revise">
          <label htmlFor="plan-comment">{t.commentLabel}</label>
          <textarea
            id="plan-comment"
            rows={3}
            value={comment}
            placeholder={t.commentPlaceholder}
            onChange={(e) => setComment(e.target.value)}
            disabled={revising}
          />
          <button type="button" className="secondary" onClick={() => void send()} disabled={revising}>
            {t.commentSend}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="muted">{t.commentUsed}</p>
      )}
    </section>
  );
}
