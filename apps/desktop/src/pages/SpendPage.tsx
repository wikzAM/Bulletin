import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listProjectSpend } from "../lib/api";
import { copy } from "../lib/copy";
import { formatCents, formatPercent } from "../lib/format";
import { summarizeSpend, type SpendOverview } from "../lib/spend";
import { PageError, PageLoading, PageShell } from "./PageStates";

export function SpendPage() {
  const t = copy.spend;
  const levels = copy.treasury.levels;
  const [overview, setOverview] = useState<SpendOverview | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setOverview(null);
    void listProjectSpend()
      .then((rows) => setOverview(summarizeSpend(rows)))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <PageError onRetry={load} />;
  if (overview === null) return <PageLoading />;

  return (
    <PageShell>
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      {overview.rows.length === 0 ? (
        <p className="muted">
          {t.empty} <Link to="/new">{copy.missionList.emptyAction}</Link>
        </p>
      ) : (
        <>
          <p className="treasury-total">
            {overview.total_budget_cents > 0
              ? t.totalOf(formatCents(overview.total_spent_cents), formatCents(overview.total_budget_cents))
              : t.total(formatCents(overview.total_spent_cents))}
          </p>
          {overview.needs_attention > 0 && (
            <p className="notice warning" role="status">
              {t.attention(overview.needs_attention)}
            </p>
          )}
          {overview.unbudgeted > 0 && <p className="muted">{t.unbudgeted(overview.unbudgeted)}</p>}
          <table className="missions">
            <thead>
              <tr>
                <th scope="col">{t.project}</th>
                <th scope="col">{t.spent}</th>
                <th scope="col">{t.budget}</th>
                <th scope="col">{t.used}</th>
              </tr>
            </thead>
            <tbody>
              {overview.rows.map((r) => {
                const level = levels[r.level];
                const pct = r.ratio === null ? 0 : Math.min(100, Math.round(r.ratio * 100));
                return (
                  <tr key={r.id} className={`level-${r.level}`}>
                    <th scope="row" data-label={t.project}>
                      <Link to={`/missions/${encodeURIComponent(r.id)}`}>{r.goal}</Link>
                      <div className="muted">{copy.missionStatus[r.status]}</div>
                    </th>
                    <td data-label={t.spent}>{formatCents(r.spent_cents)}</td>
                    <td data-label={t.budget}>{r.budget_cents === null ? t.noBudget : formatCents(r.budget_cents)}</td>
                    <td data-label={t.used}>
                      <span aria-hidden="true">{level.icon}</span> {level.label}
                      {r.ratio !== null && ` · ${formatPercent(r.ratio)}`}
                      {r.ratio !== null && (
                        <div
                          className="meter spend-meter"
                          role="meter"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={pct}
                          aria-valuetext={formatPercent(r.ratio)}
                          aria-label={`${t.used}: ${r.goal}`}
                        >
                          <div className="meter-fill" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </PageShell>
  );
}