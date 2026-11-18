import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createDesktopBridge, type DesktopBridge } from "../lib/desktop-bridge";
import { copy } from "../lib/copy";
import {
  checklistItems,
  needsSecret,
  secretNameForProvider,
  setupReady,
  type ApiProvider,
  type SetupDraft,
} from "../lib/setup";
import { createLocalSettingsStore } from "../lib/window-settings";
import { PageLoading, PageShell } from "./PageStates";

const SETUP_DONE_KEY = "bulletin.setup.done";

export function SetupPage() {
  const navigate = useNavigate();
  const t = copy.setup;
  const [bridge, setBridge] = useState<DesktopBridge | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    void createDesktopBridge().then(async (b) => {
      setBridge(b);
      const env = await b.probeEnvironment();
      setDraft({
        ...env,
        provider: null,
        repoPath: "",
        secretSaved: false,
      });
    });
  }, []);

  if (!bridge || !draft) return <PageLoading />;

  const items = checklistItems(draft);
  const ready = setupReady(draft);

  const onProvider = (provider: ApiProvider) => {
    setSavedNotice(false);
    setSecret("");
    setDraft((d) => (d ? { ...d, provider, secretSaved: !needsSecret(provider) } : d));
  };

  const saveSecret = async () => {
    if (!draft.provider) return;
    const name = secretNameForProvider(draft.provider);
    if (!name || !secret) return;
    setSaving(true);
    try {
      await bridge.secretSet(name, secret);
      setSecret(""); // never keep the value in the field
      setSavedNotice(true);
      setDraft((d) => (d ? { ...d, secretSaved: true } : d));
    } finally {
      setSaving(false);
    }
  };

  const pickRepo = async () => {
    const path = await bridge.pickFolder();
    if (path) setDraft((d) => (d ? { ...d, repoPath: path } : d));
  };

  const finish = async () => {
    if (!ready) return;
    await createLocalSettingsStore().set(SETUP_DONE_KEY, true);
    navigate("/");
  };

  return (
    <PageShell>
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>

      <ul className="setup-checks" aria-label={t.title}>
        {items.map((item) => (
          <li key={item.id} className={item.ok ? "ok" : "pending"}>
            <span aria-hidden="true">{item.ok ? "✓" : "·"}</span> {item.label}
          </li>
        ))}
      </ul>

      <fieldset className="setup-providers">
        <legend>{t.checks.provider}</legend>
        {(Object.keys(t.providers) as ApiProvider[]).map((id) => (
          <label key={id} className="setup-provider">
            <input
              type="radio"
              name="provider"
              checked={draft.provider === id}
              onChange={() => onProvider(id)}
            />{" "}
            {t.providers[id]}
          </label>
        ))}
      </fieldset>

      <div className="setup-repo">
        <label htmlFor="repo-path">{t.repoLabel}</label>
        <div className="setup-repo-row">
          <input
            id="repo-path"
            value={draft.repoPath}
            placeholder={t.repoPlaceholder}
            onChange={(e) => setDraft((d) => (d ? { ...d, repoPath: e.target.value } : d))}
          />
          <button type="button" className="secondary" onClick={() => void pickRepo()}>
            {t.repoBrowse}
          </button>
        </div>
      </div>

      {needsSecret(draft.provider) && (
        <div className="setup-secret">
          <label htmlFor="secret-input">{t.secretLabel}</label>
          <p className="muted">{t.secretHint}</p>
          <input
            id="secret-input"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button type="button" onClick={() => void saveSecret()} disabled={saving || !secret}>
            {t.secretSave}
          </button>
          {savedNotice && (
            <p className="notice" role="status">
              {t.secretSaved}
            </p>
          )}
        </div>
      )}

      <p>
        <button type="button" onClick={() => void finish()} disabled={!ready}>
          {t.continue}
        </button>
      </p>
    </PageShell>
  );
}

export { SETUP_DONE_KEY };
