import type { ModelProvider, ModelRequest, ModelResponse } from "../../../../packages/contracts/src/aiInference";
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

export function createModelProviderFromEnvironment(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  if (!enabled(env.NUSA_AI_ENABLED)) return new UnavailableModelProvider();
  const provider = env.NUSA_AI_PROVIDER?.trim().toLowerCase();
  if (provider !== "openai") return new UnavailableModelProvider();
  const apiKey = env.NUSA_AI_OPENAI_API_KEY?.trim();
  const modelVersionId = env.NUSA_AI_MODEL?.trim();
  if (!apiKey || !modelVersionId) return new UnavailableModelProvider();
  return new OpenAiResponsesModelProvider({ apiKey, modelVersionId });
}
