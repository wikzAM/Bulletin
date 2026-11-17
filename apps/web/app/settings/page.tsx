import { getSettings } from "../../lib/api";
import { copy } from "../../lib/copy";
import { settingsView } from "../../lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const t = copy.settings;
  const info = await getSettings();

  if (!info) {
    return (
      <main id="content">
        <h1>{t.title}</h1>
        <p className="notice info">{t.unavailable}</p>
      </main>
    );
  }

  const view = settingsView(info);
  return (
    <main id="content">
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

      {info.prices.length > 0 && (
        <section className="settings-section" aria-labelledby="prices-title">
          <h2 id="prices-title">{t.pricesTitle}</h2>
          <p className="muted">{t.pricesNote(info.pricesAsOf)}</p>
          <table className="settings">
            <thead>
              <tr>
                <th scope="col">{t.model}</th>
                <th scope="col">{t.input}</th>
                <th scope="col">{t.output}</th>
              </tr>
            </thead>
            <tbody>
              {info.prices.map((p) => (
                <tr key={p.model}>
                  <th scope="row">
                    <code>{p.model}</code>
                  </th>
                  <td>${p.input.toFixed(2)}</td>
                  <td>${p.output.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
