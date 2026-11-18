import type { Usage } from "@bulletin/core";

/*
 * The provider layer (spec section 9). Nothing in this file imports an SDK: stations, the engine and the
 * tests depend on these shapes only. The real SDK clients are built in ./real and injected here.
 */

/* ---- Shapes. They follow the Messages API, so an adapter over an official SDK is thin. ---- */

/**
 * Thinking blocks are opaque to Bulletin but must travel: the provider checks that a conversation's thinking
 * blocks come back unchanged, so a tool loop that dropped them from the assistant turn it resends would break.
 */
export interface ThinkingBlock {
  type: "thinking" | "redacted_thinking";
  [field: string]: unknown;
}

export type ContentBlock =
  | ThinkingBlock
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  /** The model id from config/models.json. Each provider maps it to its own id. */
  model: string;
  system: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  max_tokens: number;
  /** Aborted when the attempt is cancelled. */
  signal?: AbortSignal;
}

export interface ModelResponse {
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "refusal" | string;
  usage: Usage;
}

export type ProviderName = "anthropic" | "bedrock";

/** One model call, whichever provider serves it. Injected everywhere; tests script it. */
export interface ModelClient {
  readonly provider: ProviderName;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/* ---- Provider selection. Names only: no credential value is read, stored or printed here. ---- */

export const PROVIDER_VARIABLE = "BULLETIN_PROVIDER";

export function selectProvider(env: Readonly<Record<string, string | undefined>>): ProviderName {
  const raw = env[PROVIDER_VARIABLE]?.trim().toLowerCase();
  if (!raw) return "anthropic";
  if (raw === "anthropic" || raw === "bedrock") return raw;
  throw new Error(`${PROVIDER_VARIABLE} must be anthropic or bedrock`);
}

/**
 * Bedrock model ids carry the `anthropic.` prefix. `overrides` (from the optional `providers.bedrock.models`
 * section of config/models.json) maps a configured model id to its exact Bedrock id when that differs.
 */
export function bedrockModelId(model: string, overrides: Readonly<Record<string, string>> = {}): string {
  const mapped = overrides[model];
  if (mapped) return mapped;
  return model.startsWith("anthropic.") ? model : `anthropic.${model}`;
}

/**
 * Which environment variables are missing for a provider, by name, for a settings screen or an error.
 * Environment only: an `ant auth login` profile or workload identity federation (which the SDKs also accept)
 * is not seen here, so treat the result as a hint, not a verdict.
 */
export function missingCredentialNames(provider: ProviderName, has: (name: string) => boolean): string[] {
  if (provider === "anthropic") return has("ANTHROPIC_API_KEY") || has("ANTHROPIC_AUTH_TOKEN") ? [] : ["ANTHROPIC_API_KEY"];
  const missing: string[] = [];
  if (!has("AWS_REGION")) missing.push("AWS_REGION");
  if (!has("AWS_ACCESS_KEY_ID") && !has("AWS_PROFILE") && !has("AWS_BEARER_TOKEN_BEDROCK")) {
    missing.push("AWS_ACCESS_KEY_ID or AWS_PROFILE or AWS_BEARER_TOKEN_BEDROCK");
  }
  return missing;
}

/* ---- The adapter over an official SDK client. ---- */

export interface SdkRequestBody {
  model: string;
  max_tokens: number;
  system: string;
  messages: ModelMessage[];
  tools?: ToolDefinition[];
}

export interface SdkMessage {
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason: string | null;
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

/** The slice of `@anthropic-ai/sdk` (and its Bedrock client) this layer uses. */
export interface SdkLike {
  messages: {
    create(body: SdkRequestBody, options?: { signal?: AbortSignal }): Promise<SdkMessage>;
  };
}

function toBlocks(content: SdkMessage["content"]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const block of content) {
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      blocks.push({ ...block, type: block.type });
    } else if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      const input = block.input;
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
      });
    }
    // Server-tool results and other types the station loop never uses are dropped.
  }
  return blocks;
}

export function createSdkModelClient(options: {
  provider: ProviderName;
  sdk: SdkLike;
  /** Maps the configured model id to the provider's id. Default: unchanged. */
  resolveModel?: (model: string) => string;
}): ModelClient {
  const { provider, sdk, resolveModel = (m: string) => m } = options;
  return {
    provider,
    async complete(request) {
      const body: SdkRequestBody = {
        model: resolveModel(request.model),
        max_tokens: request.max_tokens,
        system: request.system,
        messages: request.messages,
        ...(request.tools.length > 0 ? { tools: request.tools } : {}),
      };
      // The abort signal is a per-request option of the SDK, never part of the JSON body.
      const message = await sdk.messages.create(body, request.signal ? { signal: request.signal } : undefined);
      return {
        content: toBlocks(message.content),
        stop_reason: message.stop_reason ?? "end_turn",
        usage: {
          input_tokens: message.usage.input_tokens ?? 0,
          output_tokens: message.usage.output_tokens ?? 0,
          cache_read_tokens: message.usage.cache_read_input_tokens ?? 0,
          cache_write_tokens: message.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

/** Builds the SDK clients. Injected so tests never construct a real one. */
export interface SdkFactories {
  anthropic(): SdkLike;
  bedrock(options: { region: string }): SdkLike;
}

export function createModelClient(options: {
  env: Readonly<Record<string, string | undefined>>;
  factories: SdkFactories;
  /** Exact Bedrock ids per configured model id, from the optional providers section of config/models.json. */
  bedrockModels?: Readonly<Record<string, string>>;
}): ModelClient {
  const { env, factories, bedrockModels } = options;
  const provider = selectProvider(env);
  if (provider === "anthropic") return createSdkModelClient({ provider, sdk: factories.anthropic() });
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  if (!region) throw new Error("AWS_REGION is required when BULLETIN_PROVIDER is bedrock");
  return createSdkModelClient({
    provider,
    sdk: factories.bedrock({ region }),
    resolveModel: (model) => bedrockModelId(model, bedrockModels),
  });
}
