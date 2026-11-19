import { copy } from "./copy";

export type ApiProvider = "claude-code" | "anthropic-key" | "bedrock";

/** What the first-run screen collects before the person can start a project. */
export interface SetupDraft {
  gitFound: boolean;
  claudeCliFound: boolean;
  claudeLoggedIn: boolean;
  provider: ApiProvider | null;
  repoPath: string;
  /** True after secret_set succeeded for the chosen provider (or not required). */
  secretSaved: boolean;
  /** AWS region, only sent when the provider is Amazon Bedrock. */
  awsRegion?: string;
}

export interface ChecklistItem {
  id: "git" | "claude-cli" | "claude-login" | "provider" | "repo" | "secret";
  ok: boolean;
  label: string;
}

export function secretNameForProvider(provider: ApiProvider): string | null {
  if (provider === "anthropic-key") return "ANTHROPIC_API_KEY";
  if (provider === "bedrock") return "AWS_BEARER_TOKEN_BEDROCK";
  return null;
}

export function needsSecret(provider: ApiProvider | null): boolean {
  return provider !== null && secretNameForProvider(provider) !== null;
}

/** The region field is only for Amazon Bedrock. */
export function showsAwsRegion(provider: ApiProvider | null): boolean {
  return provider === "bedrock";
}

export function checklistItems(draft: SetupDraft): ChecklistItem[] {
  const t = copy.setup.checks;
  const items: ChecklistItem[] = [
    { id: "git", ok: draft.gitFound, label: t.git },
    { id: "claude-cli", ok: draft.claudeCliFound, label: t.claudeCli },
    { id: "claude-login", ok: draft.claudeLoggedIn, label: t.claudeLogin },
    { id: "provider", ok: draft.provider !== null, label: t.provider },
    { id: "repo", ok: draft.repoPath.trim().length > 0, label: t.repo },
  ];
  if (needsSecret(draft.provider)) {
    items.push({ id: "secret", ok: draft.secretSaved, label: t.secret });
  }
  return items;
}

export function setupReady(draft: SetupDraft): boolean {
  return checklistItems(draft).every((i) => i.ok);
}
