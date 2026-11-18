import type { DesktopBridge, SettingsChange } from "../lib/desktop-bridge";
import type { SetupDraft } from "../lib/setup";

/** What first-run setup writes to the app's settings (docs/SIDECAR.md, `settings.set`). Secrets never go here. */
export function settingsToSave(draft: SetupDraft): SettingsChange {
  if (draft.provider === null) throw new Error("A provider must be chosen before setup can be saved");
  return { provider: draft.provider, repo_path: draft.repoPath.trim(), setup_complete: true };
}

/** The sidecar reads the provider when it starts; the bridge restarts it when the provider changed. */
export async function saveSetup(bridge: DesktopBridge, draft: SetupDraft): Promise<void> {
  await bridge.setSettings(settingsToSave(draft));
}
