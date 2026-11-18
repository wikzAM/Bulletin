import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listMissions } from "../lib/api";
import { copy } from "../lib/copy";
import type { MissionSummary } from "../lib/types";
import { PageError, PageLoading, PageShell } from "./PageStates";

export function ProjectsPage() {
  const t = copy.missionList;
  const [missions, setMissions] = useState<MissionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setMissions(null);
    void listMissions()
      .then(setMissions)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <PageError onRetry={load} />;
  if (missions === null) return <PageLoading />;

  return (
    <PageShell>
      <h1>{t.title}</h1>
      {missions.length === 0 ? (
        <p className="muted">
          {t.empty} <Link to="/new">{t.emptyAction}</Link>
        </p>
      ) : (
        <table className="missions">
          <thead>
            <tr>
              <th scope="col">{t.goal}</th>
              <th scope="col">{t.status}</th>
              <th scope="col">{t.progress}</th>
              <th scope="col">{t.started}</th>
            </tr>
          </thead>
          <tbody>
            {missions.map((m) => (
              <tr key={m.id}>
                <th scope="row" data-label={t.goal}>
                  <Link to={`/missions/${encodeURIComponent(m.id)}`}>{m.goal}</Link>
                </th>
                <td data-label={t.status}>
                  <span className="badge">{copy.missionStatus[m.status]}</span>
                </td>
                <td data-label={t.progress}>
                  {m.units_total === null ? "–" : `${m.units_done ?? 0} / ${m.units_total}`}
                </td>
                <td data-label={t.started}>
                  <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString("en-US")}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageShell>
  );
}