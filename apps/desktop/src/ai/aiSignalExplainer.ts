import type { StrategySignal } from "../strategy/strategyEngine";

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
  /** Recorded signal transitions, oldest to newest. Empty/omitted when the strategy
   * engine hasn't recorded any (e.g. right after restart). */
  readonly signalHistory?: readonly StrategySignal[];
}

export interface AiSignalExplainerClient {
  explain(request: SignalExplanationRequest): Promise<string>;
  answerFollowUp(input: Readonly<{ request: SignalExplanationRequest; priorExplanation: string; question: string }>): Promise<string>;
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
const INVALID_QUESTION_MESSAGE = "질문을 입력해 주세요 (최대 300자).";

const MAX_QUESTION_LENGTH = 300;
const MAX_SIGNAL_HISTORY_ENTRIES = 10;

function formatSignalHistory(history: readonly StrategySignal[] | undefined): string {
  const entries = (history ?? []).slice(-MAX_SIGNAL_HISTORY_ENTRIES);
  if (entries.length === 0) return "(no prior transitions recorded)";
  return entries.map((entry) => `${new Date(entry.timestamp).toISOString()} ${entry.type} (${entry.reason})`).join("\n");
}

function buildContextLines(request: SignalExplanationRequest): string[] {
  const priceWindow = request.recentPrices.slice(-20);
  const lines = [
    `Market: ${request.market}`,
    `Current signal: ${request.signal.type} (${request.signal.reason})`,
    `Confidence: ${request.signal.confidence.toFixed(3)}`
  ];
  if (request.signal.regime !== undefined) lines.push(`Regime: ${request.signal.regime}`);
  lines.push(`Recent signal transitions, oldest to newest:\n${formatSignalHistory(request.signalHistory)}`);
  lines.push(`Recent prices, oldest to newest: ${priceWindow.join(", ")}`);
  return lines;
}

export function buildSignalExplanationPrompt(request: SignalExplanationRequest): string {
  const lines = [
    "You are a read-only research assistant inside a PAPER-TRADING (simulation only) desktop app.",
    "You never place orders and this explanation never affects any trading decision.",
    "Explain, in Korean, in 2-4 short sentences, why the current strategy signal fired.",
    "If recent signal transitions are provided, briefly note how the signal changed leading up to now.",
    "Be concrete about the trend the numbers show. Do not recommend any action beyond describing what the signal means.",
    ...buildContextLines(request)
  ];
  return lines.join("\n");
}

export function buildSignalFollowUpPrompt(input: Readonly<{ request: SignalExplanationRequest; priorExplanation: string; question: string }>): string {
  const lines = [
    "You are a read-only research assistant inside a PAPER-TRADING (simulation only) desktop app.",
    "You never place orders and this answer never affects any trading decision.",
    "The user is asking a follow-up question about an explanation you already gave.",
    "Answer in Korean, in 1-3 short sentences, grounded only in the data below and your prior explanation.",
    "If the question asks you to recommend an action, predict future price, or give trading advice, politely decline and restate that you only describe what already happened.",
    ...buildContextLines(input.request),
    `Your previous explanation: ${input.priorExplanation}`,
    `User's follow-up question: ${input.question}`
  ];
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

export type AiSignalFollowUpStatus = "OK" | "NOT_CONFIGURED" | "NO_SIGNAL" | "INVALID_QUESTION" | "UNAVAILABLE";

export interface AiSignalFollowUpAnswer {
  readonly status: AiSignalFollowUpStatus;
  readonly answer: string;
  readonly generatedAt: number;
}

/**
 * Answers a follow-up question about an explanation already shown to the user. Requires
 * both the original request (to rebuild context) and the prior explanation text -- there is
 * no server-side conversation state, so the caller (main.ts) must have both on hand from the
 * explainStrategySignal call the user is following up on.
 */
export async function answerSignalFollowUp(input: Readonly<{
  request: SignalExplanationRequest | undefined;
  priorExplanation: string | undefined;
  question: string | undefined;
  client: AiSignalExplainerClient | undefined;
  nowMs: number;
}>): Promise<AiSignalFollowUpAnswer> {
  if (input.client === undefined) {
    return Object.freeze({ status: "NOT_CONFIGURED", answer: NOT_CONFIGURED_MESSAGE, generatedAt: input.nowMs });
  }
  if (input.request === undefined || input.priorExplanation === undefined) {
    return Object.freeze({ status: "NO_SIGNAL", answer: NO_SIGNAL_MESSAGE, generatedAt: input.nowMs });
  }
  const question = input.question?.trim();
  if (question === undefined || question.length === 0 || question.length > MAX_QUESTION_LENGTH) {
    return Object.freeze({ status: "INVALID_QUESTION", answer: INVALID_QUESTION_MESSAGE, generatedAt: input.nowMs });
  }
  try {
    const answer = await input.client.answerFollowUp({ request: input.request, priorExplanation: input.priorExplanation, question });
    return Object.freeze({ status: "OK", answer, generatedAt: input.nowMs });
  } catch {
    return Object.freeze({ status: "UNAVAILABLE", answer: UNAVAILABLE_MESSAGE, generatedAt: input.nowMs });
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
  async function callMessagesApi(prompt: string): Promise<string> {
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
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!response.ok) throw new Error(`Anthropic API request failed: HTTP ${response.status}`);
    const body = await response.json() as AnthropicMessagesResponse;
    if (body.stop_reason === "refusal") throw new Error("Anthropic API declined the request");
    const textBlock = body.content.find((block) => block.type === "text" && typeof block.text === "string");
    if (textBlock?.text === undefined) throw new Error("Anthropic API returned no text content");
    return textBlock.text;
  }
  return Object.freeze({
    explain: (request: SignalExplanationRequest) => callMessagesApi(buildSignalExplanationPrompt(request)),
    answerFollowUp: (followUp: Readonly<{ request: SignalExplanationRequest; priorExplanation: string; question: string }>) =>
      callMessagesApi(buildSignalFollowUpPrompt(followUp))
  });
}
