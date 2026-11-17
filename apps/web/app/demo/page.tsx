import Link from "next/link";
import { copy } from "../../lib/copy";
import { DEMO_SCENARIOS, demoScenario, demoState } from "../../lib/fixtures";
import { WarTableView } from "../missions/[id]/war-table";

const t = copy.demo;

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { scenario: param } = await searchParams;
  const id = Array.isArray(param) ? param[0] : param;
  const scenario = (id && demoScenario(id)) || DEMO_SCENARIOS[0];
  if (!scenario) return null;
  const text = t.scenarios[scenario.id];

  return (
    <main id="content">
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      <nav className="tabs" aria-label={t.tabsLabel}>
        {DEMO_SCENARIOS.map((s) => (
          <Link key={s.id} href={`/demo?scenario=${s.id}`} aria-current={s.id === scenario.id ? "page" : undefined}>
            {t.scenarios[s.id].title}
          </Link>
        ))}
      </nav>
      <h2>{text.title}</h2>
      <p>{text.summary}</p>
      <WarTableView state={demoState(scenario)} treasury={scenario.treasury} badge={t.badge} />
    </main>
  );
}
