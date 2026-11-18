import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getMission, getTreasury } from "../lib/api";
import { copy } from "../lib/copy";
import type { MissionDetail, TreasuryInfo } from "../lib/types";
import { WarTable } from "../components/WarTable";
import { NotFoundPage } from "./NotFoundPage";
import { PageError, PageLoading, PageShell } from "./PageStates";

export function ProjectPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const missionId = rawId ? decodeURIComponent(rawId) : "";
  const t = copy.missionPage;

  const [mission, setMission] = useState<MissionDetail | null | undefined>(undefined);
  const [treasury, setTreasury] = useState<TreasuryInfo | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!missionId) return;
    setFailed(false);
    setMission(undefined);
    void Promise.all([getMission(missionId), getTreasury(missionId)])
      .then(([m, tr]) => {
        setMission(m);
        setTreasury(tr);
      })
      .catch(() => setFailed(true));
  }, [missionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!missionId) return <NotFoundPage />;
  if (failed) return <PageError onRetry={load} />;
  if (mission === undefined) return <PageLoading />;
  if (mission === null) return <NotFoundPage />;

  return (
    <PageShell>
      <p>
        <Link to="/">
          <span aria-hidden="true">← </span>
          {t.back}
        </Link>
      </p>
      <h1>{mission.goal}</h1>
      <p className="muted">
        {mission.repo} · <span className="badge">{copy.missionStatus[mission.status]}</span> ·{" "}
        <Link to={`/missions/${encodeURIComponent(mission.id)}/lessons`}>{t.lessonsLink}</Link>
      </p>
      <WarTable missionId={mission.id} status={mission.status} units={mission.units} treasury={treasury} />
    </PageShell>
  );
}