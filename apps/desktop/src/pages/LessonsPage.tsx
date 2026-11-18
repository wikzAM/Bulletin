import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRules, type RulesResult } from "../lib/api";
import { copy } from "../lib/copy";
import { parseLessons, parseRules } from "../lib/lessons";
import { NotFoundPage } from "./NotFoundPage";
import { PageError, PageLoading, PageShell } from "./PageStates";

export function LessonsPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const missionId = rawId ? decodeURIComponent(rawId) : "";
  const t = copy.lessons;

  const [result, setResult] = useState<RulesResult | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!missionId) return;
    setFailed(false);
    setResult(null);
    void getRules(missionId)
      .then(setResult)
      .catch(() => setFailed(true));
  }, [missionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!missionId) return <NotFoundPage />;
  if (failed) return <PageError onRetry={load} />;
  if (result === null) return <PageLoading />;
  if (result.kind === "not_found") return <NotFoundPage />;

  const back = (
    <p>
      <Link to={`/missions/${encodeURIComponent(missionId)}`}>
        <span aria-hidden="true">← </span>
        {t.back}
      </Link>
    </p>
  );

  if (result.kind === "unavailable" || result.kind === "no_branch") {
    return (
      <PageShell>
        {back}
        <h1>{t.title}</h1>
        <p className="notice info">{result.kind === "no_branch" ? t.noBranch : t.unavailable}</p>
      </PageShell>
    );
  }

  const rules = parseRules(result.rules);
  const lessons = parseLessons(result.lessons);

  return (
    <PageShell>
      {back}
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>

      <section className="settings-section" aria-labelledby="rules-title">
        <h2 id="rules-title">{t.rulesTitle}</h2>
        {rules.length === 0 ? (
          <p className="muted">{t.rulesEmpty}</p>
        ) : (
          <>
            <p className="muted">{t.newestFirst}</p>
            <ul className="lesson-list">
              {rules.map((r, i) => (
                <li key={`${i}-${r.text}`}>
                  <span>{r.learned ? t.avoid(r.text) : r.text}</span>
                  <span className="muted">{r.learned ? t.learned : t.written}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="settings-section" aria-labelledby="lessons-title">
        <h2 id="lessons-title">{t.lessonsTitle}</h2>
        {lessons.length === 0 ? (
          <p className="muted">{t.lessonsEmpty}</p>
        ) : (
          <>
            <p className="muted">{t.newestFirst}</p>
            <ul className="lesson-list">
              {lessons.map((l, i) => (
                <li key={`${i}-${l.reason}`}>
                  <span>{l.reason}</span>
                  {l.taskTitle && <span className="muted">{t.task(l.taskTitle)}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </PageShell>
  );
}