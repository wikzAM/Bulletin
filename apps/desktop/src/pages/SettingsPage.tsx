import { useCallback, useEffect, useState } from "react";
import { getSettings } from "../lib/api";
import { copy } from "../lib/copy";
import { settingsView } from "../lib/settings";
import type { SettingsInfo } from "../lib/types";
import { PageError, PageLoading, PageShell } from "./PageStates";

export function SettingsPage() {
  const t = copy.settings;
  const [info, setInfo] = useState<SettingsInfo | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setInfo(undefined);
    void getSettings()
      .then(setInfo)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <PageError onRetry={load} />;
  if (info === undefined) return <PageLoading />;

  if (!info) {
    return (
      <PageShell>
        <h1>{t.title}</h1>
        <p className="notice info">{t.unavailable}</p>
      </PageShell>
    );
  }

  const view = settingsView(info);
  return (
    <PageShell>
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>

      {view.jobs.length > 0 && (
        <section className="settings-section" aria-labelledby="jobs-title">
          <h2 id="jobs-title">{t.jobsTitle}</h2>
          <table className="settings">
            <thead>
              <tr>
                <th scope="col">{t.job}</th>
                <th scope="col">{t.model}</th>
              </tr>
            </thead>
            <tbody>
              {view.jobs.map((j) => (
                <tr key={j.key}>
                  <th scope="row">{j.job}</th>
                  <td>
                    <code>{j.model}</code>
                    {j.note && <div className="muted">{j.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view.tiers.length > 0 && (
        <section className="settings-section" aria-labelledby="tiers-title">
          <h2 id="tiers-title">{t.tiersTitle}</h2>
          <table className="settings">
            <tbody>
              {view.tiers.map((x) => (
                <tr key={x.key}>
                  <th scope="row">{x.label}</th>
                  <td>
                    <code>{x.model}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view.limits.length > 0 && (
        <section className="settings-section" aria-labelledby="limits-title">
          <h2 id="limits-title">{t.limitsTitle}</h2>
          <table className="settings">
            <tbody>
              {view.limits.map((l) => (
                <tr key={l.label}>
                  <th scope="row">{l.label}</th>
                  <td>{l.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view.lanes.length > 0 && (
        <section className="settings-section" aria-labelledby="lanes-title">
          <h2 id="lanes-title">{t.lanesTitle}</h2>
          <p className="muted">{t.lanesNote}</p>
          <table className="settings">
            <tbody>
              {view.lanes.map((l) => (
                <tr key={l.key}>
                  <th scope="row">{l.label}</th>
                  <td>
                    {l.patterns.length === 0 ? (
                      t.noPatterns
                    ) : (
                      <ul className="patterns">
                        {l.patterns.map((p) => (
                          <li key={p}>
                            <code>{p}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {info.pricedModels.length > 0 && (
        <section className="settings-section" aria-labelledby="priced-title">
          <h2 id="priced-title">{t.pricedTitle}</h2>
          <p className="muted">{t.pricedNote}</p>
          <ul className="patterns">
            {info.pricedModels.map((m) => (
              <li key={m}>
                <code>{m}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}