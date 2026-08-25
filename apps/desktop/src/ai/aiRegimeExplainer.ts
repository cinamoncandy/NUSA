import type { TradingRegime, StrategyRegimeDecision } from "../strategy/regimePolicy";

/**
 * Read-only research assistant: explains, in plain Korean, what the strategy engine's current
 * market regime classification (trend/volatility bucket) means and what practical effect it
 * currently has on the strategy (preference, allowed exposure, risk multipliers). It never
 * runs automatically, never affects any trading or regime decision, and its output is
 * display-only -- the same posture as aiSignalExplainer.ts and aiRiskCommentary.ts.
 */

export interface RegimeExplanationRequest {
  readonly market: string;
  readonly regime: TradingRegime;
  readonly recentPrices: readonly number[];
  readonly decision: StrategyRegimeDecision;
}

export interface AiRegimeExplainerClient {
  explainRegime(request: RegimeExplanationRequest): Promise<string>;
}

export type AiRegimeExplanationStatus = "OK" | "NOT_CONFIGURED" | "NO_REGIME" | "UNAVAILABLE";

export interface AiRegimeExplanation {
  readonly status: AiRegimeExplanationStatus;
  readonly explanation: string;
  readonly generatedAt: number;
}

const NOT_CONFIGURED_MESSAGE = "AI 리서치 어시스턴트가 설정되지 않았습니다.";
const NO_REGIME_MESSAGE = "아직 시장 레짐을 판단할 데이터가 없습니다.";
const UNAVAILABLE_MESSAGE = "AI 레짐 설명을 지금은 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.";

export function buildRegimeExplanationPrompt(request: RegimeExplanationRequest): string {
  const priceWindow = request.recentPrices.slice(-20);
  const lines = [
    "You are a read-only research assistant inside a PAPER-TRADING (simulation only) desktop app.",
    "You never place orders, never change regime thresholds, and this explanation never affects any trading or regime decision.",
    "Explain the current market regime classification in Korean, in 3-5 short sentences, for a retail user who may not know the underlying jargon.",
    "Cover: what the regime label means in terms of recent trend and volatility, and what its PREFERRED/NEUTRAL/FORBIDDEN preference and reduced risk multipliers currently mean in practice for the strategy.",
    "Be descriptive only -- do not recommend any action, do not predict future price, and do not suggest changing any threshold.",
    `Market: ${request.market}`,
    `Regime: ${request.regime}`,
    `Recent prices, oldest to newest: ${priceWindow.join(", ")}`,
    `Strategy preference: ${request.decision.preference}`,
    `New exposure currently allowed: ${request.decision.allowNewExposure}`,
    `Reason code: ${request.decision.reason}`,
    `Position size multiplier: ${request.decision.risk.positionSizeMultiplier}`,
    `Maximum exposure multiplier: ${request.decision.risk.maximumExposureMultiplier}`,
    `Order frequency multiplier: ${request.decision.risk.orderFrequencyMultiplier}`
  ];
  return lines.join("\n");
}

export async function explainRegime(input: Readonly<{
  request: RegimeExplanationRequest | undefined;
  client: AiRegimeExplainerClient | undefined;
  nowMs: number;
}>): Promise<AiRegimeExplanation> {
  if (input.client === undefined) {
    return Object.freeze({ status: "NOT_CONFIGURED", explanation: NOT_CONFIGURED_MESSAGE, generatedAt: input.nowMs });
  }
  if (input.request === undefined) {
    return Object.freeze({ status: "NO_REGIME", explanation: NO_REGIME_MESSAGE, generatedAt: input.nowMs });
  }
  try {
    const explanation = await input.client.explainRegime(input.request);
    return Object.freeze({ status: "OK", explanation, generatedAt: input.nowMs });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", explanation: UNAVAILABLE_MESSAGE, generatedAt: input.nowMs });
  }
}

interface AnthropicMessagesResponse {
  readonly stop_reason: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}

/** Raw HTTP against the Messages API, matching this codebase's fetch-not-SDK convention. */
export function createAnthropicRegimeExplainerClient(input: Readonly<{ apiKey: string; model?: string; fetchImpl?: typeof fetch }>): AiRegimeExplainerClient {
  const model = input.model ?? "claude-opus-5";
  const fetchImpl = input.fetchImpl ?? fetch;
  return Object.freeze({
    async explainRegime(request: RegimeExplanationRequest): Promise<string> {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: buildRegimeExplanationPrompt(request) }]
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
