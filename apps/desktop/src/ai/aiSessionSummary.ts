import type { StrategySignal, StrategySignalType } from "../strategy/strategyEngine";

/**
 * Read-only research assistant: on demand, synthesizes account state, recent signal
 * activity, and the AI challenger's agreement rate into a short natural-language session
 * summary. It never runs automatically, never affects any trading decision, and its output
 * is display-only -- the same posture as aiSignalExplainer.ts and aiChallengerObserver.ts.
 */

export interface SessionSummaryRequest {
  readonly market: string;
  readonly account: Readonly<{ cash: number; equity: number; unrealizedPnl: number; realizedPnl: number }>;
  readonly latestSignal?: Readonly<{ type: StrategySignalType; reason: string }>;
  readonly signalHistory: readonly StrategySignal[];
  readonly challengerStats: Readonly<{ totalObservations: number; agreementCount: number; agreementRate: number | null }>;
}

export interface AiSessionSummaryClient {
  summarize(request: SessionSummaryRequest): Promise<string>;
}

export type AiSessionSummaryStatus = "OK" | "NOT_CONFIGURED" | "NO_DATA" | "UNAVAILABLE";

export interface AiSessionSummary {
  readonly status: AiSessionSummaryStatus;
  readonly summary: string;
  readonly generatedAt: number;
}

const NOT_CONFIGURED_MESSAGE = "AI 리서치 어시스턴트가 설정되지 않았습니다.";
const NO_DATA_MESSAGE = "아직 시세 데이터가 없어 세션을 요약할 수 없습니다.";
const UNAVAILABLE_MESSAGE = "AI 요약을 지금은 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.";

const MAX_SIGNAL_HISTORY_ENTRIES = 10;

function formatSignalHistory(history: readonly StrategySignal[]): string {
  const entries = history.slice(-MAX_SIGNAL_HISTORY_ENTRIES);
  if (entries.length === 0) return "(no prior transitions recorded)";
  return entries.map((entry) => `${new Date(entry.timestamp).toISOString()} ${entry.type} (${entry.reason})`).join("\n");
}

export function buildSessionSummaryPrompt(request: SessionSummaryRequest): string {
  const lines = [
    "You are a read-only research assistant inside a PAPER-TRADING (simulation only) desktop app.",
    "You never place orders and this summary never affects any trading decision.",
    "Summarize the current paper-trading session in Korean, in 3-5 short sentences.",
    "Cover: how the account's PnL looks, what the strategy's recent signal activity shows, and (if any observations exist) how often a separate AI comparison agreed with the strategy's signals.",
    "Be descriptive only -- do not recommend any action or predict future price.",
    `Market: ${request.market}`,
    `Cash: ${request.account.cash}`,
    `Equity: ${request.account.equity}`,
    `Unrealized PnL: ${request.account.unrealizedPnl}`,
    `Realized PnL: ${request.account.realizedPnl}`
  ];
  lines.push(request.latestSignal === undefined ? "Latest signal: none yet" : `Latest signal: ${request.latestSignal.type} (${request.latestSignal.reason})`);
  lines.push(`Recent signal transitions, oldest to newest:\n${formatSignalHistory(request.signalHistory)}`);
  lines.push(
    request.challengerStats.totalObservations === 0
      ? "AI challenger comparison: no observations yet"
      : `AI challenger comparison: agreed with the strategy in ${request.challengerStats.agreementCount} of ${request.challengerStats.totalObservations} observations (${((request.challengerStats.agreementRate ?? 0) * 100).toFixed(0)}%)`
  );
  return lines.join("\n");
}

export async function summarizeSession(input: Readonly<{
  request: SessionSummaryRequest | undefined;
  client: AiSessionSummaryClient | undefined;
  nowMs: number;
}>): Promise<AiSessionSummary> {
  if (input.client === undefined) {
    return Object.freeze({ status: "NOT_CONFIGURED", summary: NOT_CONFIGURED_MESSAGE, generatedAt: input.nowMs });
  }
  if (input.request === undefined) {
    return Object.freeze({ status: "NO_DATA", summary: NO_DATA_MESSAGE, generatedAt: input.nowMs });
  }
  try {
    const summary = await input.client.summarize(input.request);
    return Object.freeze({ status: "OK", summary, generatedAt: input.nowMs });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", summary: UNAVAILABLE_MESSAGE, generatedAt: input.nowMs });
  }
}

interface AnthropicMessagesResponse {
  readonly stop_reason: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}

/** Raw HTTP against the Messages API, matching this codebase's fetch-not-SDK convention. */
export function createAnthropicSessionSummaryClient(input: Readonly<{ apiKey: string; model?: string; fetchImpl?: typeof fetch }>): AiSessionSummaryClient {
  const model = input.model ?? "claude-opus-5";
  const fetchImpl = input.fetchImpl ?? fetch;
  return Object.freeze({
    async summarize(request: SessionSummaryRequest): Promise<string> {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: buildSessionSummaryPrompt(request) }]
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
