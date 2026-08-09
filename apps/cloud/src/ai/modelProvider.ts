import type { ModelProvider, ModelRequest, ModelResponse } from "../../../../packages/contracts/src/aiInference";
import { AnthropicMessagesModelProvider } from "./anthropicMessagesModelProvider";
import { OpenAiResponsesModelProvider } from "./openAiResponsesModelProvider";

export class ModelProviderUnavailableError extends Error {
  public constructor() {
    super("AI model provider unavailable");
    this.name = "ModelProviderUnavailableError";
  }
}

/** A provider boundary with no network, credentials, or execution capability. */
export class UnavailableModelProvider implements ModelProvider {
  public readonly providerId = "unavailable";
  public readonly modelVersionId = "unavailable";

  public infer(_request: ModelRequest): Promise<ModelResponse> {
    return Promise.reject(new ModelProviderUnavailableError());
  }
}

export interface ModelProviderStatus {
  readonly status: "UNAVAILABLE" | "CONFIGURED";
  readonly providerId: string | null;
  readonly modelVersionId: string | null;
  readonly credentialMaterialExposed: false;
}

export interface NVersionProviderEnvironmentGroup {
  readonly groupId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly modelFamilyId: string;
  readonly provider: ModelProvider;
}

export interface NVersionProviderEnvironmentPool {
  readonly status: "CONFIGURED";
  readonly groups: readonly NVersionProviderEnvironmentGroup[];
  readonly credentialMaterialExposed: false;
}

export type ModelTransport = (request: ModelRequest) => Promise<ModelResponse>;

/** Adapter for an approved model SDK. The transport receives evidence-only input. */
export class TransportModelProvider implements ModelProvider {
  public constructor(
    public readonly providerId: string,
    public readonly modelVersionId: string,
    private readonly transport: ModelTransport
  ) {}

  public infer(request: ModelRequest): Promise<ModelResponse> {
    return this.transport(request);
  }
}

export function describeModelProvider(provider: ModelProvider): ModelProviderStatus {
  const unavailable = provider.providerId === "unavailable";
  return Object.freeze({ status: unavailable ? "UNAVAILABLE" : "CONFIGURED", providerId: unavailable ? null : provider.providerId, modelVersionId: unavailable ? null : provider.modelVersionId, credentialMaterialExposed: false });
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";
const text = (value: string | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export function createModelProviderFromEnvironment(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  if (!enabled(env.NUSA_AI_ENABLED)) return new UnavailableModelProvider();
  const provider = env.NUSA_AI_PROVIDER?.trim().toLowerCase();
  const modelVersionId = text(env.NUSA_AI_MODEL);
  if (provider === "openai") {
    const apiKey = text(env.NUSA_AI_OPENAI_API_KEY);
    return apiKey != null && modelVersionId != null ? new OpenAiResponsesModelProvider({ apiKey, modelVersionId }) : new UnavailableModelProvider();
  }
  if (provider === "anthropic") {
    const apiKey = text(env.NUSA_AI_ANTHROPIC_API_KEY);
    return apiKey != null && modelVersionId != null ? new AnthropicMessagesModelProvider({ apiKey, modelVersionId }) : new UnavailableModelProvider();
  }
  return new UnavailableModelProvider();
}

/**
 * N-version comparison is a separately explicit capability. It never infers missing groups from the
 * primary provider configuration and never duplicates one credential/model as independent evidence.
 */
export function createNVersionProviderPoolFromEnvironment(env: NodeJS.ProcessEnv = process.env): NVersionProviderEnvironmentPool | null {
  if (!enabled(env.NUSA_AI_ENABLED) || !enabled(env.NUSA_AI_NVERSION_ENABLED)) return null;
  const openAiKey = text(env.NUSA_AI_OPENAI_API_KEY);
  const openAiModel = text(env.NUSA_AI_OPENAI_MODEL);
  const openAiFamily = text(env.NUSA_AI_OPENAI_FAMILY_ID);
  const anthropicKey = text(env.NUSA_AI_ANTHROPIC_API_KEY);
  const anthropicModel = text(env.NUSA_AI_ANTHROPIC_MODEL);
  const anthropicFamily = text(env.NUSA_AI_ANTHROPIC_FAMILY_ID);
  if (openAiKey == null || openAiModel == null || openAiFamily == null || anthropicKey == null || anthropicModel == null || anthropicFamily == null) return null;
  const openai = new OpenAiResponsesModelProvider({ apiKey: openAiKey, modelVersionId: openAiModel });
  const anthropic = new AnthropicMessagesModelProvider({ apiKey: anthropicKey, modelVersionId: anthropicModel });
  return Object.freeze({
    status: "CONFIGURED" as const,
    credentialMaterialExposed: false as const,
    groups: Object.freeze([
      Object.freeze({ groupId: "openai-independent", providerId: openai.providerId, modelVersionId: openai.modelVersionId, modelFamilyId: openAiFamily, provider: openai }),
      Object.freeze({ groupId: "anthropic-independent", providerId: anthropic.providerId, modelVersionId: anthropic.modelVersionId, modelFamilyId: anthropicFamily, provider: anthropic })
    ])
  });
}
