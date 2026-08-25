import type { StrategySignalType } from "../strategy/strategyEngine";
import type { AiChallengerObservation } from "./aiChallengerObserver";

/**
 * Read-only research assistant: on demand, explains why the AI challenger's hypothetical
 * signal diverged from the champion strategy's real signal for one already-recorded
 * observation. Same posture as aiSignalExplainer.ts -- display-only, never affects any
 * trading decision, never runs automatically.
 */

export interface DisagreementExplanationRequest {
  readonly market: string;
  readonly championSignal: Readonly<{ type: StrategySignalType; reason: string }>;
  readonly aiSignal: Readonly<{ type: StrategySignalType; reason: string; confidence: number }>;
}

export interface AiDisagreementExplainerClient {
  explainDisagreement(request: DisagreementExplanationRequest): Promise<string>;
}

export type AiDisagreementExplanationStatus = "OK" | "NOT_CONFIGURED" | "NO_DISAGREEMENT" | "UNAVAILABLE";

export interface AiDisagreementExplanation {
  readonly status: AiDisagreementExplanationStatus;
  readonly explanation: string;
  readonly generatedAt: number;
}

const NOT_CONFIGURED_MESSAGE = "AI 리서치 어시스턴트가 설정되지 않았습니다.";
const NO_DISAGREEMENT_MESSAGE = "현재 AI 챌린저와 챔피언 신호가 일치하거나, 아직 관찰 기록이 없습니다.";
const UNAVAILABLE_MESSAGE = "AI 설명을 지금은 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.";

export function buildDisagreementExplanationPrompt(request: DisagreementExplanationRequest): string {
  return [
    "You are a read-only research assistant inside a PAPER-TRADING (simulation only) desktop app.",
    "You never place orders and this explanation never affects any trading decision.",
    "A rule-based strategy (the champion) and a separate hypothetical AI comparison (the challenger) produced DIFFERENT signals for the same market moment.",
    "Explain, in Korean, in 2-4 short sentences, why the two likely diverged -- contrast what each reasoning emphasized.",
    "Do not say one signal is correct or recommend any action; describe the divergence only.",
    `Market: ${request.market}`,
    `Champion signal: ${request.championSignal.type} (${request.championSignal.reason})`,
    `AI challenger signal: ${request.aiSignal.type} (${request.aiSignal.reason}, confidence ${request.aiSignal.confidence.toFixed(2)})`
  ].join("\n");
}

export async function explainChallengerDisagreement(input: Readonly<{
  observation: AiChallengerObservation | undefined;
  client: AiDisagreementExplainerClient | undefined;
  nowMs: number;
}>): Promise<AiDisagreementExplanation> {
  if (input.client === undefined) {
    return Object.freeze({ status: "NOT_CONFIGURED", explanation: NOT_CONFIGURED_MESSAGE, generatedAt: input.nowMs });
  }
  if (input.observation === undefined || input.observation.agreesWithChampion) {
    return Object.freeze({ status: "NO_DISAGREEMENT", explanation: NO_DISAGREEMENT_MESSAGE, generatedAt: input.nowMs });
  }
  try {
    const explanation = await input.client.explainDisagreement({
      market: input.observation.market,
      championSignal: input.observation.championSignal,
      aiSignal: input.observation.aiSignal
    });
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
export function createAnthropicDisagreementExplainerClient(input: Readonly<{ apiKey: string; model?: string; fetchImpl?: typeof fetch }>): AiDisagreementExplainerClient {
  const model = input.model ?? "claude-opus-5";
  const fetchImpl = input.fetchImpl ?? fetch;
  return Object.freeze({
    async explainDisagreement(request: DisagreementExplanationRequest): Promise<string> {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: buildDisagreementExplanationPrompt(request) }]
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
