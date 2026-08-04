import type { StrategySignal } from "./strategyEngine";

/**
 * Read-only research assistant: explains an already-computed strategy signal in
 * plain language. It never runs before a signal exists, never feeds anything
 * back into strategy/risk logic, and its output is display-only -- an LLM
 * explanation is not itself trading evidence and must never be treated as one.
 */

export interface SignalExplanationRequest {
  readonly market: string;
  readonly signal: StrategySignal;
  readonly recentPrices: readonly number[];
}

export interface AiSignalExplainerClient {
  explain(request: SignalExplanationRequest): Promise<string>;
}

export type AiSignalExplanationStatus = "OK" | "NOT_CONFIGURED" | "NO_SIGNAL" | "UNAVAILABLE";

export interface AiSignalExplanation {
  readonly status: AiSignalExplanationStatus;
  readonly explanation: string;
  readonly signal?: Readonly<{ type: StrategySignal["type"]; reason: string; timestamp: number }>;
  readonly generatedAt: number;
}

const NOT_CONFIGURED_MESSAGE = "AI 리서치 어시스턴트가 설정되지 않았습니다.";
const NO_SIGNAL_MESSAGE = "아직 전략 신호가 없습니다.";
const UNAVAILABLE_MESSAGE = "AI 설명을 지금은 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.";

export function buildSignalExplanationPrompt(request: SignalExplanationRequest): string {
  const priceWindow = request.recentPrices.slice(-20);
  const lines = [
    "You are a read-only research assistant inside a PAPER-TRADING (simulation only) desktop app.",
    "You never place orders and this explanation never affects any trading decision.",
    "Explain, in Korean, in 2-4 short sentences, why the following strategy signal fired.",
    "Be concrete about the trend the numbers show. Do not recommend any action beyond describing what the signal means.",
    `Market: ${request.market}`,
    `Signal: ${request.signal.type} (${request.signal.reason})`,
    `Confidence: ${request.signal.confidence.toFixed(3)}`
  ];
  if (request.signal.regime !== undefined) lines.push(`Regime: ${request.signal.regime}`);
  lines.push(`Recent prices, oldest to newest: ${priceWindow.join(", ")}`);
  return lines.join("\n");
}

export async function explainStrategySignal(input: Readonly<{
  request: SignalExplanationRequest | undefined;
  client: AiSignalExplainerClient | undefined;
  nowMs: number;
}>): Promise<AiSignalExplanation> {
  if (input.client === undefined) {
    return Object.freeze({ status: "NOT_CONFIGURED", explanation: NOT_CONFIGURED_MESSAGE, generatedAt: input.nowMs });
  }
  if (input.request === undefined) {
    return Object.freeze({ status: "NO_SIGNAL", explanation: NO_SIGNAL_MESSAGE, generatedAt: input.nowMs });
  }
  try {
    const explanation = await input.client.explain(input.request);
    return Object.freeze({
      status: "OK",
      explanation,
      signal: Object.freeze({ type: input.request.signal.type, reason: input.request.signal.reason, timestamp: input.request.signal.timestamp }),
      generatedAt: input.nowMs
    });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", explanation: UNAVAILABLE_MESSAGE, generatedAt: input.nowMs });
  }
}

interface AnthropicMessagesResponse {
  readonly stop_reason: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}

/**
 * Raw HTTP against the Messages API, matching this codebase's existing convention
 * of calling external HTTP APIs (see upbitMinuteCandleSource.ts) with fetch rather
 * than an SDK dependency.
 */
export function createAnthropicSignalExplainerClient(input: Readonly<{
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}>): AiSignalExplainerClient {
  const model = input.model ?? "claude-opus-5";
  const fetchImpl = input.fetchImpl ?? fetch;
  return Object.freeze({
    async explain(request: SignalExplanationRequest): Promise<string> {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: buildSignalExplanationPrompt(request) }]
        })
      });
      if (!response.ok) throw new Error(`Anthropic API request failed: HTTP ${response.status}`);
      const body = await response.json() as AnthropicMessagesResponse;
      if (body.stop_reason === "refusal") throw new Error("Anthropic API declined the request");
      const textBlock = body.content.find((block) => block.type === "text" && typeof block.text === "string");
      if (textBlock?.text === undefined) throw new Error("Anthropic API returned no text content");
      return textBlock.text;
    }
  });
}
