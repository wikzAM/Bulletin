import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getReport } from "../lib/api";
import { copy } from "../lib/copy";
import { formatCents, formatPercent } from "../lib/format";
import { reportLines, type ReportOutcome } from "../lib/report";
import { NotFoundPage } from "./NotFoundPage";
import { PageError, PageShell } from "./PageStates";

/** Numbers from GET /missions/:id/report. Missing metrics say they are not available yet. */
export function ReportPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const missionId = rawId ? decodeURIComponent(rawId) : "";
  const [outcome, setOutcome] = useState<ReportOutcome | "loading" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!missionId) return;
    let cancel = false;
    setOutcome("loading");
    getReport(missionId)
      .then((next) => {
        if (!cancel) setOutcome(next);
      })
      .catch(() => {
        if (!cancel) setOutcome("error");
      });
    return () => {
      cancel = true;
    };
  }, [missionId, attempt]);

  if (!missionId) return <NotFoundPage />;
  if (outcome === "error") return <PageError onRetry={() => setAttempt((n) => n + 1)} />;

  const t = copy.report;
  const lines = outcome !== "loading" && outcome.kind === "ready"
    ? reportLines(outcome.report, formatCents, formatPercent)
    : null;

  return (
    <PageShell>
      <p>
        <Link to={`/missions/${encodeURIComponent(missionId)}`}>
          <span aria-hidden="true">← </span>
          {t.back}
        </Link>
      </p>
      <h1>{t.title}</h1>
      {outcome === "loading" ? <p className="muted">{t.loading}</p> : null}
      {outcome !== "loading" && outcome.kind === "not_available" ? (
        <p className="muted">{t.unavailable}</p>
      ) : null}
      {lines ? (
        <dl className="report-lines">
          {lines.map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </PageShell>
  );
}
