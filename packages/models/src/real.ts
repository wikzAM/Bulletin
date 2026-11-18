import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { createModelClient, type ModelClient, type SdkFactories, type SdkLike } from "./index";

/*
 * The real SDK clients. Only this file imports the SDKs, so tests and the runners never load them.
 * Neither client is given a key: each SDK reads its own credentials from the environment (ANTHROPIC_API_KEY,
 * or AWS_* / AWS_BEARER_TOKEN_BEDROCK), so no secret value passes through Bulletin's code.
 */

export const realFactories: SdkFactories = {
  anthropic: () => new Anthropic() as unknown as SdkLike,
  bedrock: ({ region }) => new AnthropicBedrockMantle({ awsRegion: region }) as unknown as SdkLike,
};

/** The model client for BULLETIN_PROVIDER (anthropic by default). */
export function createRealModelClient(
  env: Readonly<Record<string, string | undefined>> = process.env,
  bedrockModels?: Readonly<Record<string, string>>,
): ModelClient {
  return createModelClient({ env, factories: realFactories, bedrockModels });
}
