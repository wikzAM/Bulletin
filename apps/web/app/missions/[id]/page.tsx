import Link from "next/link";
import { notFound } from "next/navigation";
import { getMission, getTreasury } from "../../../lib/api";
import { copy } from "../../../lib/copy";
import { WarTable } from "./war-table";

export const dynamic = "force-dynamic";

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const missionId = decodeURIComponent(id);
  const [mission, treasury] = await Promise.all([getMission(missionId), getTreasury(missionId)]);
  const t = copy.missionPage;

  if (!mission) notFound();

  return (
    <main id="content">
      <p>
        <Link href="/">
          <span aria-hidden="true">← </span>
          {t.back}
        </Link>
      </p>
      <h1>{mission.goal}</h1>
      <p className="muted">
        {mission.repo} · <span className="badge">{copy.missionStatus[mission.status]}</span>
      </p>
      <WarTable missionId={mission.id} status={mission.status} units={mission.units} treasury={treasury} />
    </main>
  );
}
