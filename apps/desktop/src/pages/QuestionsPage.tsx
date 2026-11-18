import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listMissions, listQuestions } from "../lib/api";
import { copy } from "../lib/copy";
import { parseFilter } from "../lib/questions";
import type { Question } from "../lib/types";
import { QuestionBoard } from "../components/QuestionBoard";
import { PageError, PageLoading, PageShell } from "./PageStates";

export function QuestionsPage() {
  const [searchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get("status") ?? undefined);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setQuestions(null);
    void Promise.all([listQuestions(), listMissions()])
      .then(([qs, missions]) => {
        setQuestions(qs);
        setGoals(Object.fromEntries(missions.map((m) => [m.id, m.goal])));
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <PageError onRetry={load} />;
  if (questions === null) return <PageLoading />;

  return (
    <PageShell>
      <h1>{copy.questions.title}</h1>
      <p className="muted">{copy.questions.intro}</p>
      <QuestionBoard initial={questions} filter={filter} goals={goals} />
    </PageShell>
  );
}