import { aiSha256, type ModelFailure, type ModelRequest, type ModelResponse, type ModelProvider, type StructuredAgentOutput } from "../../../../packages/contracts/src/aiInference";

export type StructuredOutputValidator = (value: unknown) => StructuredAgentOutput;
export type AgentExecutionResult =
  | { readonly ok: true; readonly response: ModelResponse; readonly output: StructuredAgentOutput; readonly outputHash: string }
  | { readonly ok: false; readonly failure: ModelFailure };

const failure = (request: ModelRequest, code: ModelFailure["code"], retryable: boolean): ModelFailure => Object.freeze({ requestId: request.requestId, code, retryable, providerId: request.providerId, modelVersionId: request.modelVersionId, occurredAt: Date.now() });

export class AgentExecutor {
  public constructor(private readonly provider: ModelProvider, private readonly maxRetries = 1) {
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) throw new Error("AI retry policy is invalid");
  }

  public async execute(request: ModelRequest, validate: StructuredOutputValidator): Promise<AgentExecutionResult> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const current = { ...request, attempt };
      try {
        const response = await this.withTimeout(this.provider.infer(current), request.timeoutMs);
        if (response.requestId !== request.requestId || response.providerId !== request.providerId || response.modelVersionId !== request.modelVersionId || response.promptArtifactDigest !== request.promptArtifactDigest || response.contextHash !== request.contextHash || response.inputHash !== request.inputHash) return { ok: false, failure: failure(request, "SCHEMA_VIOLATION", false) };
        const encoded = JSON.stringify(response.structuredOutput);
        if (encoded == null || Buffer.byteLength(encoded, "utf8") > request.maxOutputBytes) return { ok: false, failure: failure(request, "OUTPUT_TOO_LARGE", false) };
        const outputHash = aiSha256(response.structuredOutput);
        if (response.outputHash !== outputHash) return { ok: false, failure: failure(request, "SCHEMA_VIOLATION", false) };
        const output = validate(response.structuredOutput);
        return { ok: true, response, output, outputHash };
      } catch (error) {
        const code: ModelFailure["code"] = error instanceof Error && error.name === "TimeoutError"
          ? "TIMEOUT"
          : error instanceof Error && /schema|structured|observation|decision|severity|result|references/i.test(error.message)
            ? "SCHEMA_VIOLATION"
            : "PROVIDER_UNAVAILABLE";
        if (attempt >= this.maxRetries) return { ok: false, failure: failure(request, code, code === "TIMEOUT" || code === "PROVIDER_UNAVAILABLE") };
      }
    }
    return { ok: false, failure: failure(request, "UNKNOWN", false) };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) return Promise.reject(new Error("invalid timeout"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { const error = new Error("model request timed out"); error.name = "TimeoutError"; reject(error); }, timeoutMs);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
    });
  }
}
