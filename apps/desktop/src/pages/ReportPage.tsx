import { Link, useParams } from "react-router-dom";
import { copy } from "../lib/copy";
import { NotFoundPage } from "./NotFoundPage";
import { PageShell } from "./PageStates";

/** Stub until the web app ships a report view. */
export function ReportPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const missionId = rawId ? decodeURIComponent(rawId) : "";
  if (!missionId) return <NotFoundPage />;

  return (
    <PageShell>
      <p>
        <Link to={`/missions/${encodeURIComponent(missionId)}`}>
          <span aria-hidden="true">← </span>
          {copy.missionPage.back}
        </Link>
      </p>
      <h1>Project report</h1>
      <p className="muted">Coming soon.</p>
    </PageShell>
  );
}