import { useEffect, useState } from "react";
import pkg from "../../package.json";
import { copy } from "../lib/copy";
import { buildDiagnosticsText, type DiagnosticsInfo } from "../lib/diagnostics";
import { createDesktopBridge } from "../lib/desktop-bridge";
import { detectTransportKind } from "../lib/transport";
import { PageShell } from "./PageStates";

async function loadDiagnostics(): Promise<DiagnosticsInfo> {
  let sidecarStatus: string;
  let dataFolder = "(browser)";
  try {
    if (detectTransportKind() === "tauri") {
      const { invoke } = await import("@tauri-apps/api/core");
      const health = await invoke<{ status?: string }>("rpc", { method: "health", params: {} });
      sidecarStatus = health?.status ?? "ok";
      dataFolder = (await invoke<string>("data_folder", {})) || dataFolder;
    } else {
      sidecarStatus = "mock (browser)";
      const bridge = await createDesktopBridge();
      void bridge;
    }
  } catch {
    sidecarStatus = "unreachable";
  }
  return { appVersion: pkg.version, sidecarStatus, dataFolder };
}

export function AboutPage() {
  const t = copy.about;
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadDiagnostics().then(setInfo);
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
