import type { Settings } from "../../api/src/platform/settings";

/**
 * The first-run screen records a provider in settings.json (`claude-code`, `anthropic-key` or `bedrock`); the engine
 * reads BULLETIN_PROVIDER and BULLETIN_RUNNER. When the environment does not set them, this fills them in at start:
 * a provider with its own credentials means the General and the stations call the API directly (runner `sdk`), and
 * `claude-code` keeps the Claude Code runner. An explicit environment value always wins.
 */
export function applyProviderSettings(env: NodeJS.Dict<string>, settings: Settings): void {
  const provider = settings.provider === "anthropic-key" ? "anthropic" : settings.provider === "bedrock" ? "bedrock" : undefined;
  if (!provider) return;
  if (!env.BULLETIN_PROVIDER?.trim()) env.BULLETIN_PROVIDER = provider;
  if (!env.BULLETIN_RUNNER?.trim()) env.BULLETIN_RUNNER = "sdk";
  if (provider === "bedrock" && typeof settings.aws_region === "string" && !env.AWS_REGION?.trim()) env.AWS_REGION = settings.aws_region;
}
