import Link from "next/link";
import { notFound } from "next/navigation";
import { getRules } from "../../../../lib/api";
import { copy } from "../../../../lib/copy";
import { parseLessons, parseRules } from "../../../../lib/lessons";

export const dynamic = "force-dynamic";

export default async function LessonsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const missionId = decodeURIComponent(id);
  const result = await getRules(missionId);
  const t = copy.lessons;

  if (result.kind === "not_found") notFound();

  const back = (
    <p>
      <Link href={`/missions/${encodeURIComponent(missionId)}`}>
        <span aria-hidden="true">← </span>
        {t.back}
      </Link>
    </p>
  );

  if (result.kind === "unavailable" || result.kind === "no_branch") {
    return (
      <main id="content">
        {back}
        <h1>{t.title}</h1>
        <p className="notice info">{result.kind === "no_branch" ? t.noBranch : t.unavailable}</p>
      </main>
    );
  }

  const rules = parseRules(result.rules);
  const lessons = parseLessons(result.lessons);

  return (
    <main id="content">
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
    </main>
  );
}
