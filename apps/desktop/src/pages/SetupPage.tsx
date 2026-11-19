import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createDesktopBridge, type DesktopBridge } from "../lib/desktop-bridge";
import { copy } from "../lib/copy";
import {
  checklistItems,
  needsSecret,
  secretNameForProvider,
  setupReady,
  showsAwsRegion,
  type ApiProvider,
  type SetupDraft,
} from "../lib/setup";
import { repoInspectionLines } from "../lib/repo-inspection";
import { createLocalSettingsStore } from "../lib/window-settings";
import { PageLoading, PageShell } from "./PageStates";
import { saveSetup } from "./SetupPage.settings";

const SETUP_DONE_KEY = "bulletin.setup.done";

export function SetupPage() {
  const navigate = useNavigate();
  const t = copy.setup;
  const [bridge, setBridge] = useState<DesktopBridge | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [repoNote, setRepoNote] = useState<string[]>([]);

  useEffect(() => {
    void createDesktopBridge().then(async (b) => {
      setBridge(b);
      const env = await b.probeEnvironment();
      setDraft({
        ...env,
        provider: null,
        repoPath: "",
        secretSaved: false,
        awsRegion: "",
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

  const lookAtRepo = async (path: string) => {
    const trimmed = path.trim();
    if (!bridge || !trimmed) {
      setRepoNote([]);
      return;
    }
    try {
      setRepoNote(repoInspectionLines(await bridge.inspectRepo(trimmed)));
    } catch {
      setRepoNote([t.repoInspectFailed]);
    }
  };

  const pickRepo = async () => {
    const path = await bridge.pickFolder();
    if (!path) return;
    setDraft((d) => (d ? { ...d, repoPath: path } : d));
    await lookAtRepo(path);
  };

  const finish = async () => {
    if (!ready) return;
    try {
      await saveSetup(bridge, draft);
    } catch {
      // The choice is also kept locally below; the sidecar keeps its default provider until this saves.
    }
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

      {showsAwsRegion(draft.provider) && (
        <div className="setup-region">
          <label htmlFor="aws-region">{t.regionLabel}</label>
          <p className="muted">{t.regionHint}</p>
          <input
            id="aws-region"
            value={draft.awsRegion ?? ""}
            placeholder={t.regionPlaceholder}
            onChange={(e) => setDraft((d) => (d ? { ...d, awsRegion: e.target.value } : d))}
          />
        </div>
      )}

      <div className="setup-repo">
        <label htmlFor="repo-path">{t.repoLabel}</label>
        <div className="setup-repo-row">
          <input
            id="repo-path"
            value={draft.repoPath}
            placeholder={t.repoPlaceholder}
            onChange={(e) => setDraft((d) => (d ? { ...d, repoPath: e.target.value } : d))}
            onBlur={(e) => void lookAtRepo(e.target.value)}
          />
          <button type="button" className="secondary" onClick={() => void pickRepo()}>
            {t.repoBrowse}
          </button>
        </div>
        {repoNote.length > 0 ? (
          <p className="muted" role="status">
            {repoNote.join(" ")}
          </p>
        ) : null}
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
