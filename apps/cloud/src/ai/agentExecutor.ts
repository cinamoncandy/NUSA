import { aiSha256, type ModelFailure, type ModelRequest, type ModelResponse, type ModelProvider, type StructuredAgentOutput } from "../../../../packages/contracts/src/aiInference";
import type { AiInferenceResourceController } from "../../../../packages/contracts/src/aiInferenceResources";

export type StructuredOutputValidator = (value: unknown) => StructuredAgentOutput;
export type AgentExecutionResult =
  | { readonly ok: true; readonly response: ModelResponse; readonly output: StructuredAgentOutput; readonly outputHash: string }
  | { readonly ok: false; readonly failure: ModelFailure };

const failure = (request: ModelRequest, code: ModelFailure["code"], retryable: boolean, occurredAt: number): ModelFailure => Object.freeze({ requestId: request.requestId, code, retryable, providerId: request.providerId, modelVersionId: request.modelVersionId, occurredAt });

export class AgentExecutor {
  public constructor(
    private readonly provider: ModelProvider,
    private readonly maxRetries = 1,
    private readonly resources?: AiInferenceResourceController,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) throw new Error("AI retry policy is invalid");
  }

  public async execute(request: ModelRequest, validate: StructuredOutputValidator): Promise<AgentExecutionResult> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const current = Object.freeze({ ...request, attempt });
      const startedAt = this.now();
      if (this.resources != null && !this.resources.reserveAttempt(current, startedAt)) return { ok: false, failure: failure(current, "CONTEXT_INVALID", false, startedAt) };
      try {
        const response = await this.withTimeout(this.provider.infer(current), request.timeoutMs);
        const completedAt = this.now();
        if (this.resources != null && !this.resources.completeAttempt(current, response, completedAt)) return { ok: false, failure: failure(current, "CONTEXT_INVALID", false, completedAt) };
        if (response.requestId !== request.requestId || response.providerId !== request.providerId || response.modelVersionId !== request.modelVersionId || response.promptArtifactDigest !== request.promptArtifactDigest || response.contextHash !== request.contextHash || response.inputHash !== request.inputHash) return { ok: false, failure: failure(current, "SCHEMA_VIOLATION", false, completedAt) };
        const encoded = JSON.stringify(response.structuredOutput);
        if (encoded == null || Buffer.byteLength(encoded, "utf8") > request.maxOutputBytes) return { ok: false, failure: failure(current, "OUTPUT_TOO_LARGE", false, completedAt) };
        const outputHash = aiSha256(response.structuredOutput);
        if (response.outputHash !== outputHash) return { ok: false, failure: failure(current, "SCHEMA_VIOLATION", false, completedAt) };
        let output: StructuredAgentOutput;
        try {
          output = validate(response.structuredOutput);
        } catch {
          return { ok: false, failure: failure(current, "SCHEMA_VIOLATION", false, completedAt) };
        }
        return { ok: true, response, output, outputHash };
      } catch (error) {
        const failedAt = this.now();
        this.resources?.failAttempt(current, failedAt);
        if (this.resources != null && this.resources.snapshot(failedAt).health !== "HEALTHY") return { ok: false, failure: failure(current, "CONTEXT_INVALID", false, failedAt) };
        const code: ModelFailure["code"] = error instanceof Error && error.name === "TimeoutError"
          ? "TIMEOUT"
          : error instanceof Error && error.name === "OutputTooLargeError"
            ? "OUTPUT_TOO_LARGE"
            : error instanceof Error && error.name === "MalformedModelOutputError"
              ? "MALFORMED_OUTPUT"
              : "PROVIDER_UNAVAILABLE";
        if (attempt >= this.maxRetries) return { ok: false, failure: failure(current, code, code === "TIMEOUT" || code === "PROVIDER_UNAVAILABLE", failedAt) };
      }
    }
    const at = this.now();
    return { ok: false, failure: failure(request, "UNKNOWN", false, at) };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) return Promise.reject(new Error("invalid timeout"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { const error = new Error("model request timed out"); error.name = "TimeoutError"; reject(error); }, timeoutMs);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
    });
  }
}
