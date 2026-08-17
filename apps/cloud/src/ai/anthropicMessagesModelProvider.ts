import { aiSha256, type ModelProvider, type ModelRequest, type ModelResponse, type ModelUsage } from "../../../../packages/contracts/src/aiInference";
import { structuredOutputSchema } from "./structuredOutputSchema";

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type AnthropicFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  }
) => Promise<AnthropicHttpResponse>;

/**
 * Thinking depth for the structured agent calls. Current Claude models think by
 * default, and max_tokens bounds thinking and response text together, so depth is
 * controlled here rather than by disabling thinking (disabling it can leak internal
 * tags into the response and corrupt the structured output).
 */
export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicMessagesModelProviderOptions {
  readonly apiKey: string;
  readonly modelVersionId: string;
  readonly effort?: AnthropicEffort;
  readonly fetchImpl?: AnthropicFetch;
  readonly now?: () => number;
}

const defaultFetch: AnthropicFetch = async (url, init) => fetch(url, { method: init.method, headers: { ...init.headers }, body: init.body, signal: init.signal });

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`AI structured ${name} is malformed`);
  return value as Record<string, unknown>;
};

const optionalToken = (source: Record<string, unknown>, key: string): number => {
  const value = source[key];
  if (value == null) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("AI structured usage is malformed");
  return value as number;
};

const requiredToken = (source: Record<string, unknown>, key: string): number => {
  const value = source[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("AI structured usage is malformed");
  return value as number;
};

const usageFrom = (value: unknown): ModelUsage => {
  const source = record(value, "usage");
  const baseInput = requiredToken(source, "input_tokens");
  const cacheCreation = optionalToken(source, "cache_creation_input_tokens");
  const cacheRead = optionalToken(source, "cache_read_input_tokens");
  const output = requiredToken(source, "output_tokens");
  const input = baseInput + cacheCreation + cacheRead;
  const total = input + output;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(total)) throw new Error("AI structured usage is malformed");
  return Object.freeze({ inputTokens: input, outputTokens: output, totalTokens: total });
};

const outputTextFrom = (value: unknown): string => {
  if (!Array.isArray(value)) throw new Error("AI structured output is malformed");
  const texts: string[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) throw new Error("AI structured output is malformed");
    const block = item as Record<string, unknown>;
    if (block.type !== "text" || typeof block.text !== "string" || block.text.trim() === "") throw new Error("AI structured output is malformed");
    texts.push(block.text);
  }
  if (texts.length !== 1) throw new Error("AI structured output is malformed");
  return texts[0]!;
};

const namedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

export class AnthropicMessagesModelProvider implements ModelProvider {
  public readonly providerId = "anthropic";
  public readonly modelVersionId: string;
  #apiKey: string;
  private readonly effort: AnthropicEffort;
  private readonly fetchImpl: AnthropicFetch;
  private readonly now: () => number;

  public constructor(options: AnthropicMessagesModelProviderOptions) {
    this.#apiKey = options.apiKey.trim();
    this.modelVersionId = options.modelVersionId.trim();
    if (!this.#apiKey || !this.modelVersionId) throw new Error("AI provider configuration is incomplete");
    this.effort = options.effort ?? "low";
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
      max_tokens: request.maxTokens,
      system: request.instructions,
      messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(request.input) }] }],
      output_config: {
        effort: this.effort,
        format: {
          type: "json_schema",
          schema: structuredOutputSchema(request.role)
        }
      }
    });
    let response: AnthropicHttpResponse;
    try {
      response = await this.fetchImpl(ANTHROPIC_MESSAGES_ENDPOINT, {
        method: "POST",
        headers: Object.freeze({ "x-api-key": this.#apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" }),
        body,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw namedError("TimeoutError", "AI model provider timed out");
      throw new Error("AI model provider unavailable");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`AI model provider HTTP failure ${response.status}`);
    let envelope: Record<string, unknown>;
    try { envelope = record(JSON.parse(await response.text()), "response"); }
    catch { throw namedError("MalformedModelOutputError", "AI structured response is malformed"); }
    if (envelope.type !== "message") throw namedError("MalformedModelOutputError", "AI structured response is malformed");
    if (envelope.model !== this.modelVersionId) throw new Error("AI structured response model mismatch");
    if (envelope.stop_reason !== "end_turn") throw new Error("AI structured response is incomplete");
    let outputText: string;
    try { outputText = outputTextFrom(envelope.content); }
    catch { throw namedError("MalformedModelOutputError", "AI structured output is malformed"); }
    if (Buffer.byteLength(outputText, "utf8") > request.maxOutputBytes) throw namedError("OutputTooLargeError", "AI structured output exceeds size limit");
    let structuredOutput: unknown;
    try { structuredOutput = JSON.parse(outputText) as unknown; }
    catch { throw namedError("MalformedModelOutputError", "AI structured output is malformed"); }
    let usage: ModelUsage;
    try { usage = usageFrom(envelope.usage); }
    catch { throw namedError("MalformedModelOutputError", "AI structured usage is malformed"); }
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
      usage,
      startedAt,
      completedAt
    });
  }
}
