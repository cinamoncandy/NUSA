import { aiSha256, type AiAgentRole, type ModelProvider, type ModelRequest, type ModelResponse, type ModelUsage } from "../../../../packages/contracts/src/aiInference";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

type JsonSchema = Readonly<Record<string, unknown>>;

export interface OpenAiHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type OpenAiFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  }
) => Promise<OpenAiHttpResponse>;

export interface OpenAiResponsesModelProviderOptions {
  readonly apiKey: string;
  readonly modelVersionId: string;
  readonly fetchImpl?: OpenAiFetch;
  readonly now?: () => number;
}

const defaultFetch: OpenAiFetch = async (url, init) => fetch(url, { method: init.method, headers: { ...init.headers }, body: init.body, signal: init.signal });

const stringArraySchema = (): JsonSchema => ({ type: "array", items: { type: "string" } });

const payloadSchema = (role: AiAgentRole): JsonSchema => {
  if (role === "EVIDENCE_PRODUCER") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["observations", "missingEvidence", "evidenceBundleHash"],
      properties: {
        observations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim", "claimType", "evidenceReferences", "confidence", "freshnessStatus"],
            properties: {
              claim: { type: "string" },
              claimType: { type: "string", enum: ["fact", "derived", "assumption", "unknown"] },
              evidenceReferences: stringArraySchema(),
              confidence: { type: "string" },
              freshnessStatus: { type: "string", enum: ["fresh", "stale", "conflicted", "unknown"] }
            }
          }
        },
        missingEvidence: stringArraySchema(),
        evidenceBundleHash: { type: "string" }
      }
    };
  }
  if (role === "STRATEGY_PROPOSER") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["strategyVersionId", "decision", "rationaleClaims", "assumptions", "uncertainty", "rawProbability", "expectedEffect", "costSensitivity", "capacitySensitivity"],
      properties: {
        strategyVersionId: { type: "string" },
        decision: { type: "string", enum: ["candidate", "no_action", "insufficient_evidence"] },
        rationaleClaims: stringArraySchema(),
        assumptions: stringArraySchema(),
        uncertainty: { type: "string" },
        rawProbability: { type: "number", minimum: 0, maximum: 1 },
        expectedEffect: { type: "string" },
        costSensitivity: { type: "string" },
        capacitySensitivity: { type: "string" }
      }
    };
  }
  if (role === "ADVERSARIAL_CRITIC") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["reviewedProposalHash", "counterClaims", "failedAssumptions", "missingTests", "alternativeExplanations", "severity"],
      properties: {
        reviewedProposalHash: { type: "string" },
        counterClaims: stringArraySchema(),
        failedAssumptions: stringArraySchema(),
        missingTests: stringArraySchema(),
        alternativeExplanations: stringArraySchema(),
        severity: { type: "string", enum: ["none", "low", "medium", "high", "critical"] }
      }
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["result", "hardDenies", "warnings", "missingRequirements", "requiredEscalations", "policyReferences"],
    properties: {
      result: { type: "string", enum: ["verified", "denied", "incomplete"] },
      hardDenies: stringArraySchema(),
      warnings: stringArraySchema(),
      missingRequirements: stringArraySchema(),
      requiredEscalations: stringArraySchema(),
      policyReferences: stringArraySchema()
    }
  };
};

export const openAiStructuredOutputSchema = (role: AiAgentRole): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "role", "evidenceReferences", "payload"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    role: { type: "string", enum: [role] },
    evidenceReferences: stringArraySchema(),
    payload: payloadSchema(role)
  }
});

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`AI structured ${name} is malformed`);
  return value as Record<string, unknown>;
};

const usageFrom = (value: unknown): ModelUsage => {
  const source = record(value, "usage");
  const token = (key: string): number => {
    const item = source[key];
    if (!Number.isSafeInteger(item) || (item as number) < 0) throw new Error("AI structured usage is malformed");
    return item as number;
  };
  return Object.freeze({ inputTokens: token("input_tokens"), outputTokens: token("output_tokens"), totalTokens: token("total_tokens") });
};

const outputTextFrom = (value: unknown): string => {
  if (!Array.isArray(value)) throw new Error("AI structured output is malformed");
  const texts: string[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const outputItem = item as Record<string, unknown>;
    if (outputItem.type !== "message" || !Array.isArray(outputItem.content)) continue;
    for (const content of outputItem.content) {
      if (content == null || typeof content !== "object") continue;
      const part = content as Record<string, unknown>;
      if (part.type === "refusal") throw new Error("AI structured output was refused");
      if (part.type === "output_text" && typeof part.text === "string") texts.push(part.text);
    }
  }
  if (texts.length !== 1 || !texts[0]?.trim()) throw new Error("AI structured output is malformed");
  return texts[0];
};

const namedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

const timeoutError = (): Error => namedError("TimeoutError", "AI model provider timed out");

export class OpenAiResponsesModelProvider implements ModelProvider {
  public readonly providerId = "openai";
  public readonly modelVersionId: string;
  private readonly apiKey: string;
  private readonly fetchImpl: OpenAiFetch;
  private readonly now: () => number;

  public constructor(options: OpenAiResponsesModelProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.modelVersionId = options.modelVersionId.trim();
    if (!this.apiKey || !this.modelVersionId) throw new Error("AI provider configuration is incomplete");
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.now = options.now ?? Date.now;
  }

  public async infer(request: ModelRequest): Promise<ModelResponse> {
    if (request.providerId !== this.providerId || request.modelVersionId !== this.modelVersionId) throw new Error("AI structured provider/model schema mismatch");
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 120_000) throw new Error("AI provider timeout is invalid");
    const startedAt = this.now();
    if (!Number.isSafeInteger(startedAt) || startedAt <= 0) throw new Error("AI provider clock is invalid");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const body = JSON.stringify({
      model: this.modelVersionId,
      instructions: request.instructions,
      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(request.input) }] }],
      max_output_tokens: request.maxTokens,
      store: false,
      tools: [],
      text: {
        format: {
          type: "json_schema",
          name: `nusa_${request.role.toLowerCase()}`,
          strict: true,
          schema: openAiStructuredOutputSchema(request.role)
        }
      }
    });
    let response: OpenAiHttpResponse;
    try {
      response = await this.fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: Object.freeze({ Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }),
        body,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw timeoutError();
      throw new Error("AI model provider unavailable");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`AI model provider HTTP failure ${response.status}`);
    let envelope: Record<string, unknown>;
    try { envelope = record(JSON.parse(await response.text()), "response"); }
    catch { throw namedError("MalformedModelOutputError", "AI structured response is malformed"); }
    if (envelope.status !== "completed") throw new Error("AI structured response is incomplete");
    if (envelope.model !== this.modelVersionId) throw new Error("AI structured response model mismatch");
    const outputText = outputTextFrom(envelope.output);
    if (Buffer.byteLength(outputText, "utf8") > request.maxOutputBytes) throw namedError("OutputTooLargeError", "AI structured output exceeds size limit");
    let structuredOutput: unknown;
    try { structuredOutput = JSON.parse(outputText) as unknown; }
    catch { throw namedError("MalformedModelOutputError", "AI structured output is malformed"); }
    const completedAt = this.now();
    if (!Number.isSafeInteger(completedAt) || completedAt < startedAt) throw new Error("AI provider clock is invalid");
    return Object.freeze({
      requestId: request.requestId,
      providerId: this.providerId,
      modelVersionId: this.modelVersionId,
      promptArtifactDigest: request.promptArtifactDigest,
      contextHash: request.contextHash,
      inputHash: request.inputHash,
      structuredOutput,
      outputHash: aiSha256(structuredOutput),
      usage: usageFrom(envelope.usage),
      startedAt,
      completedAt
    });
  }
}
