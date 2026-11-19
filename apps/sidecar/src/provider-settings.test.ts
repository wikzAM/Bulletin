import { expect, it } from "vitest";
import type { Settings } from "../../api/src/platform/settings";
import { applyProviderSettings } from "./provider-settings";

it("maps the provider chosen on first run to the variables the engine reads, when nothing sets them", () => {
  const anthropic: NodeJS.Dict<string> = {};
  applyProviderSettings(anthropic, { provider: "anthropic-key" });
  expect(anthropic).toEqual({ BULLETIN_PROVIDER: "anthropic", BULLETIN_RUNNER: "sdk" });

  const bedrock: NodeJS.Dict<string> = {};
  applyProviderSettings(bedrock, { provider: "bedrock" });
  expect(bedrock).toEqual({ BULLETIN_PROVIDER: "bedrock", BULLETIN_RUNNER: "sdk" });
});

it("leaves the Claude Code login alone, and does nothing without a provider setting", () => {
  for (const settings of [{ provider: "claude-code" }, {}, { setup_complete: true }] as Settings[]) {
    const env: NodeJS.Dict<string> = {};
    applyProviderSettings(env, settings);
    expect(env).toEqual({});
  }
});

it("never overrides what the environment already says; a blank value counts as unset", () => {
  const explicit: NodeJS.Dict<string> = { BULLETIN_PROVIDER: "bedrock", BULLETIN_RUNNER: "managed" };
  applyProviderSettings(explicit, { provider: "anthropic-key" });
  expect(explicit).toEqual({ BULLETIN_PROVIDER: "bedrock", BULLETIN_RUNNER: "managed" });

  const runnerOnly: NodeJS.Dict<string> = { BULLETIN_RUNNER: "claude" };
  applyProviderSettings(runnerOnly, { provider: "anthropic-key" });
  expect(runnerOnly).toEqual({ BULLETIN_PROVIDER: "anthropic", BULLETIN_RUNNER: "claude" });

  const blank: NodeJS.Dict<string> = { BULLETIN_PROVIDER: "  ", BULLETIN_RUNNER: "" };
  applyProviderSettings(blank, { provider: "bedrock" });
  expect(blank).toEqual({ BULLETIN_PROVIDER: "bedrock", BULLETIN_RUNNER: "sdk" });
});

it("passes the Bedrock region saved on first run to AWS_REGION, unless the environment already sets one", () => {
  const fresh: NodeJS.Dict<string> = {};
  applyProviderSettings(fresh, { provider: "bedrock", aws_region: "eu-west-1" });
  expect(fresh).toEqual({ BULLETIN_PROVIDER: "bedrock", BULLETIN_RUNNER: "sdk", AWS_REGION: "eu-west-1" });

  const explicit: NodeJS.Dict<string> = { AWS_REGION: "us-east-1" };
  applyProviderSettings(explicit, { provider: "bedrock", aws_region: "eu-west-1" });
  expect(explicit.AWS_REGION).toBe("us-east-1");

  const notBedrock: NodeJS.Dict<string> = {};
  applyProviderSettings(notBedrock, { provider: "anthropic-key", aws_region: "eu-west-1" });
  expect(notBedrock.AWS_REGION).toBeUndefined();
});
