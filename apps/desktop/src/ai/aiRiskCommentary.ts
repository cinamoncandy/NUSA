import type { RiskDashboardSection, DashboardStatus } from "../../../cloud/src/dashboardAggregator";

/**
 * Read-only research assistant: on demand, explains the current risk dashboard section
 * (drawdown, portfolio heat, liquidation buffer, kill switch) in plain Korean. It never runs
 * automatically, never affects any trading decision or the risk gate, and its output is
 * display-only -- the same posture as aiSessionSummary.ts and aiSignalExplainer.ts.
 */

export interface RiskCommentaryRequest {
  readonly market: string;
  readonly dashboardStatus: DashboardStatus;
  readonly risk: RiskDashboardSection;
  readonly warnings: readonly string[];
}

export interface AiRiskCommentaryClient {
  explainRisk(request: RiskCommentaryRequest): Promise<string>;
}

export type AiRiskCommentaryStatus = "OK" | "NOT_CONFIGURED" | "NO_DATA" | "UNAVAILABLE";

export interface AiRiskCommentary {
  readonly status: AiRiskCommentaryStatus;
  readonly commentary: string;
  readonly generatedAt: number;
}

const NOT_CONFIGURED_MESSAGE = "AI 리서치 어시스턴트가 설정되지 않았습니다.";
const NO_DATA_MESSAGE = "아직 리스크 지표 데이터가 없어 설명할 수 없습니다.";
const UNAVAILABLE_MESSAGE = "AI 리스크 코멘터리를 지금은 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.";

export function buildRiskCommentaryPrompt(request: RiskCommentaryRequest): string {
  const lines = [
    "You are a read-only research assistant inside a PAPER-TRADING (simulation only) desktop app.",
    "You never place orders, never adjust risk limits, and this commentary never affects any trading decision or the risk gate.",
    "Explain the current risk dashboard in Korean, in 3-5 short sentences, for a retail user who may not know the underlying metrics.",
    "Cover: what the drawdown, portfolio heat, and liquidation buffer numbers mean in plain terms, and whether the kill switch is currently active.",
    "Be descriptive only -- do not recommend any action, do not predict future price, and do not suggest changing any setting.",
    `Market: ${request.market}`,
    `Dashboard status: ${request.dashboardStatus}`,
    `Risk section status: ${request.risk.status}`,
    `Kill switch active: ${request.risk.killSwitchActive}`,
    `Daily drawdown ratio: ${request.risk.dailyDrawdownRatio}`,
    `Portfolio heat ratio: ${request.risk.portfolioHeatRatio}`,
    `Liquidation buffer ratio: ${request.risk.liquidationBufferRatio}`,
    `Risk section reasons: ${request.risk.reasons.length === 0 ? "(none)" : request.risk.reasons.join("; ")}`,
    `Dashboard warnings: ${request.warnings.length === 0 ? "(none)" : request.warnings.join("; ")}`
  ];
  return lines.join("\n");
}

export async function explainRiskCommentary(input: Readonly<{
  request: RiskCommentaryRequest | undefined;
  client: AiRiskCommentaryClient | undefined;
  nowMs: number;
}>): Promise<AiRiskCommentary> {
  if (input.client === undefined) {
    return Object.freeze({ status: "NOT_CONFIGURED", commentary: NOT_CONFIGURED_MESSAGE, generatedAt: input.nowMs });
  }
  if (input.request === undefined) {
    return Object.freeze({ status: "NO_DATA", commentary: NO_DATA_MESSAGE, generatedAt: input.nowMs });
  }
  try {
    const commentary = await input.client.explainRisk(input.request);
    return Object.freeze({ status: "OK", commentary, generatedAt: input.nowMs });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", commentary: UNAVAILABLE_MESSAGE, generatedAt: input.nowMs });
  }
}

interface AnthropicMessagesResponse {
  readonly stop_reason: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}

/** Raw HTTP against the Messages API, matching this codebase's fetch-not-SDK convention. */
export function createAnthropicRiskCommentaryClient(input: Readonly<{ apiKey: string; model?: string; fetchImpl?: typeof fetch }>): AiRiskCommentaryClient {
  const model = input.model ?? "claude-opus-5";
  const fetchImpl = input.fetchImpl ?? fetch;
  return Object.freeze({
    async explainRisk(request: RiskCommentaryRequest): Promise<string> {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: buildRiskCommentaryPrompt(request) }]
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
