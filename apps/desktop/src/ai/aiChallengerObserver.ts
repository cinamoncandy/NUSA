import { createHash } from "node:crypto";
import type { StrategySignalType } from "../strategy/strategyEngine";
import type { TradingRegime } from "../strategy/regimePolicy";

/**
 * Read-only AI "challenger" observer: on each champion signal transition, asks an LLM what
 * it would have signaled given the same market data, and records the comparison. It NEVER
 * touches PaperBroker, the risk gate, or any order path -- there is no method here that could
 * place, size, or approve a trade. This is strictly an observability/comparison feature, not
 * a second trading strategy.
 */

export interface AiChallengerRequest {
  readonly market: string;
  readonly recentPrices: readonly number[];
  readonly regime?: TradingRegime;
}

export interface AiChallengerSignal {
  readonly type: StrategySignalType;
  readonly reason: string;
  readonly confidence: number;
}

export interface AiChallengerClient {
  generateSignal(request: AiChallengerRequest): Promise<AiChallengerSignal>;
}

export interface AiChallengerObservation {
  readonly timestamp: number;
  readonly market: string;
  readonly championSignal: Readonly<{ type: StrategySignalType; reason: string }>;
  readonly aiSignal: AiChallengerSignal;
  readonly agreesWithChampion: boolean;
}

export interface AiChallengerEvent extends AiChallengerObservation {
  readonly sequence: number;
  readonly previousEventSha256: string;
  readonly eventSha256: string;
}

const canonicalize = (value: unknown): unknown =>
  value === null || typeof value !== "object" ? value : Array.isArray(value) ? value.map(canonicalize) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");

const VALID_TYPES: readonly StrategySignalType[] = ["BUY", "SELL", "HOLD"];

export function buildChallengerSignalPrompt(request: AiChallengerRequest): string {
  const priceWindow = request.recentPrices.slice(-20);
  const lines = [
    "You are a hypothetical trading strategy inside a PAPER-TRADING (simulation only) research tool.",
    "Your output is NEVER used to place an order -- it is recorded only for comparison against a separate, already-running rule-based strategy.",
    "Given the market data below, decide what signal you would generate: BUY, SELL, or HOLD.",
    `Market: ${request.market}`,
    `Recent prices, oldest to newest: ${priceWindow.join(", ")}`
  ];
  if (request.regime !== undefined) lines.push(`Regime: ${request.regime}`);
  lines.push(
    "Respond with ONLY a single-line JSON object, no markdown, no explanation outside the JSON:",
    '{"type": "BUY" | "SELL" | "HOLD", "reason": "<one short sentence in Korean>", "confidence": <number between 0 and 1>}'
  );
  return lines.join("\n");
}

function parseChallengerSignal(text: string): AiChallengerSignal {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("challenger response was not JSON");
  const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  if (typeof value.type !== "string" || !VALID_TYPES.includes(value.type as StrategySignalType)) throw new Error("challenger response had an invalid signal type");
  if (typeof value.reason !== "string" || value.reason.trim().length === 0 || value.reason.length > 300) throw new Error("challenger response had an invalid reason");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("challenger response had an invalid confidence");
  return Object.freeze({ type: value.type as StrategySignalType, reason: value.reason, confidence: value.confidence });
}

interface AnthropicMessagesResponse {
  readonly stop_reason: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}

/** Raw HTTP against the Messages API, matching this codebase's fetch-not-SDK convention. */
export function createAnthropicChallengerClient(input: Readonly<{ apiKey: string; model?: string; fetchImpl?: typeof fetch }>): AiChallengerClient {
  const model = input.model ?? "claude-opus-5";
  const fetchImpl = input.fetchImpl ?? fetch;
  return Object.freeze({
    async generateSignal(request: AiChallengerRequest): Promise<AiChallengerSignal> {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: buildChallengerSignalPrompt(request) }]
        })
      });
      if (!response.ok) throw new Error(`Anthropic API request failed: HTTP ${response.status}`);
      const body = await response.json() as AnthropicMessagesResponse;
      if (body.stop_reason === "refusal") throw new Error("Anthropic API declined the request");
      const textBlock = body.content.find((block) => block.type === "text" && typeof block.text === "string");
      if (textBlock?.text === undefined) throw new Error("Anthropic API returned no text content");
      return parseChallengerSignal(textBlock.text);
    }
  });
}

/**
 * Fires an AI signal request only when the champion strategy's signal type changes (mirrors
 * StrategyEngine's own transition-only recording), never more than once concurrently. A slow
 * or failed AI call is silently skipped -- it never blocks or affects the champion's tick path,
 * since observe() is fire-and-forget from the caller's perspective (main.ts never awaits it).
 */
export class AiChallengerObserver {
  private readonly events: AiChallengerEvent[] = [];
  private latest: AiChallengerObservation | undefined;
  private lastChampionType: StrategySignalType | undefined;
  private inFlight = false;

  constructor(private readonly client: AiChallengerClient | undefined, private readonly nowMs: () => number = Date.now) {}

  /** Returns the in-flight promise when a call was actually started (useful for tests to
   * await completion), or undefined when skipped (no client, already in flight, or no
   * champion signal transition). A transition skipped only because a prior call was still
   * in flight is NOT considered consumed -- lastChampionType only advances when a call is
   * actually started, so the next observe() will still see and act on it. */
  observe(input: Readonly<{ market: string; championSignal: Readonly<{ type: StrategySignalType; reason: string }>; recentPrices: readonly number[]; regime?: TradingRegime }>): Promise<void> | undefined {
    const transitioned = this.lastChampionType !== input.championSignal.type;
    if (this.client === undefined || this.inFlight || !transitioned) return undefined;
    this.lastChampionType = input.championSignal.type;
    this.inFlight = true;
    return this.client.generateSignal({ market: input.market, recentPrices: input.recentPrices, regime: input.regime })
      .then((aiSignal) => {
        const observation: AiChallengerObservation = Object.freeze({
          timestamp: this.nowMs(),
          market: input.market,
          championSignal: Object.freeze({ type: input.championSignal.type, reason: input.championSignal.reason }),
          aiSignal,
          agreesWithChampion: aiSignal.type === input.championSignal.type
        });
        this.latest = observation;
        this.append(observation);
      })
      .catch(() => { /* best-effort observation; a failed AI call leaves the prior state unchanged */ })
      .finally(() => { this.inFlight = false; });
  }

  getLatestObservation(): AiChallengerObservation | undefined { return this.latest; }
  eventLog(): readonly AiChallengerEvent[] { return Object.freeze([...this.events]); }
  /** Most recent observations first, capped at limit. Strips the hash-chain bookkeeping
   * fields (sequence/previousEventSha256/eventSha256) -- callers that need those for
   * integrity verification should use eventLog() instead. */
  getHistory(limit = 50): readonly AiChallengerObservation[] {
    return Object.freeze(this.events.slice(-limit).reverse().map(({ timestamp, market, championSignal, aiSignal, agreesWithChampion }) =>
      Object.freeze({ timestamp, market, championSignal, aiSignal, agreesWithChampion })));
  }
  /** agreementRate is null (not 0) when there are no observations yet, so callers can tell
   * "no data" apart from "AI has never once agreed with the champion". */
  getStats(): Readonly<{ totalObservations: number; agreementCount: number; agreementRate: number | null }> {
    const totalObservations = this.events.length;
    const agreementCount = this.events.reduce((count, event) => count + (event.agreesWithChampion ? 1 : 0), 0);
    return Object.freeze({ totalObservations, agreementCount, agreementRate: totalObservations === 0 ? null : agreementCount / totalObservations });
  }

  private append(observation: AiChallengerObservation): void {
    const raw = { sequence: this.events.length + 1, ...observation, previousEventSha256: this.events.at(-1)?.eventSha256 ?? "GENESIS" };
    this.events.push(Object.freeze({ ...raw, eventSha256: hash(raw) }));
  }
}

export function verifyAiChallengerEvents(events: readonly AiChallengerEvent[]): readonly string[] {
  const errors: string[] = [];
  let previous = "GENESIS";
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.sequence !== index + 1) errors.push("MISSING_SEQUENCE");
    const { eventSha256, ...raw } = event;
    if (event.previousEventSha256 !== previous || hash(raw) !== eventSha256) errors.push("EVENT_HASH_MISMATCH");
    previous = event.eventSha256;
  }
  return Object.freeze([...new Set(errors)].sort());
}
