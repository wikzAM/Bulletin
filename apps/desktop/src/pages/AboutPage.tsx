import { useEffect, useState } from "react";
import pkg from "../../package.json";
import { copy } from "../lib/copy";
import { buildDiagnosticsText, loadDiagnostics, type DiagnosticsInfo } from "../lib/diagnostics";
import { detectTransportKind } from "../lib/transport";
import { PageShell } from "./PageStates";

async function readDiagnostics(): Promise<DiagnosticsInfo> {
  if (detectTransportKind() !== "tauri") return loadDiagnostics({ appVersion: pkg.version, kind: "http" });
  const { invoke } = await import("@tauri-apps/api/core");
  return loadDiagnostics({ appVersion: pkg.version, kind: "tauri", invoke: (cmd, args) => invoke<unknown>(cmd, args) });
}

export function AboutPage() {
  const t = copy.about;
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void readDiagnostics().then(setInfo);
  }, []);

  const copyText = async () => {
    if (!info) return;
    const text = buildDiagnosticsText(info);
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <PageShell>
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>
      {info ? (
        <dl className="about-dl">
          <dt>{t.version}</dt>
          <dd>{info.appVersion}</dd>
          <dt>{t.sidecar}</dt>
          <dd>{info.sidecarStatus}</dd>
          <dt>{t.dataFolder}</dt>
          <dd>
            <code>{info.dataFolder}</code>
          </dd>
        </dl>
      ) : (
        <p className="muted">{copy.states.loading}</p>
      )}
      <button type="button" onClick={() => void copyText()} disabled={!info}>
        {t.copy}
      </button>
      {copied && (
        <p className="notice" role="status">
          {t.copied}
        </p>
      )}
    </PageShell>
  );
}
