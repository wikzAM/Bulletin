import { listMissions, listQuestions } from "../../lib/api";
import { copy } from "../../lib/copy";
import { parseFilter } from "../../lib/questions";
import { QuestionBoard } from "./question-board";

export const dynamic = "force-dynamic";

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ status }, questions, missions] = await Promise.all([searchParams, listQuestions(), listMissions()]);
  const goals = Object.fromEntries(missions.map((m) => [m.id, m.goal]));

  return (
    <main id="content">
      <h1>{copy.questions.title}</h1>
      <p className="muted">{copy.questions.intro}</p>
      <QuestionBoard initial={questions} filter={parseFilter(status)} goals={goals} />
    </main>
  );
}
