import type { ModelProvider, ModelRequest, ModelResponse } from "../../../../packages/contracts/src/aiInference";

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

export function createModelProviderFromEnvironment(_env: NodeJS.ProcessEnv = process.env): ModelProvider {
  // AI is intentionally unavailable until an explicit, application-owned provider is injected.
  // No credential or network fallback is allowed in the default cloud composition.
  return new UnavailableModelProvider();
}
