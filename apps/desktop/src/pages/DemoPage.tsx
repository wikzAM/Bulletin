import { Link, useSearchParams } from "react-router-dom";
import { copy } from "../lib/copy";
import { DEMO_SCENARIOS, demoScenario, demoState } from "../lib/fixtures";
import { WarTableView } from "../components/WarTable";
import { PageShell } from "./PageStates";

const t = copy.demo;

export function DemoPage() {
  const [searchParams] = useSearchParams();
  const param = searchParams.get("scenario");
  const scenario = (param && demoScenario(param)) || DEMO_SCENARIOS[0];
  if (!scenario) return null;
  const text = t.scenarios[scenario.id];
  const state = demoState(scenario);

  return (
    <PageShell>
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      <nav className="tabs" aria-label={t.tabsLabel}>
        {DEMO_SCENARIOS.map((s) => (
          <Link key={s.id} to={`/demo?scenario=${s.id}`} aria-current={s.id === scenario.id ? "page" : undefined}>
            {t.scenarios[s.id].title}
          </Link>
        ))}
      </nav>
      <h2>{text.title}</h2>
      <p>{text.summary}</p>
      <WarTableView units={scenario.units} state={state} treasury={scenario.treasury} badge={t.badge} />
    </PageShell>
  );
}