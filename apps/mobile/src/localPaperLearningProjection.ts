import type { PaperLearningUiEvent } from "./paperLearningScreen";
import type { WatchlistMarket } from "./watchlist";

const LOCAL_PAPER_MARKET = "KRW-BTC";
const LOCAL_OBSERVER_STRATEGY = "LOCAL_PUBLIC_OBSERVER_V1";
const MAX_LOCAL_EVENTS = 120;
const LOCAL_PUBLIC_DATA_MAX_AGE_MS = 120_000;
let localEvents: readonly PaperLearningUiEvent[] = Object.freeze([]);

export interface LocalPaperLearningReadiness {
  readonly dataReady: boolean;
  readonly status: "RUNNING" | "PAUSED";
  readonly reason: "LOCAL_PUBLIC_MARKET_DATA_READY" | "LOCAL_PUBLIC_MARKET_DATA_UNAVAILABLE" | "LOCAL_PUBLIC_MARKET_DATA_STALE";
  readonly lastObservedAt: number | null;
}

function validObservedAt(value: string): number | null {
  const observedAt = Date.parse(value);
  return Number.isSafeInteger(observedAt) && observedAt > 0 ? observedAt : null;
}

function boundedAppend(events: readonly PaperLearningUiEvent[]): void {
  const merged = new Map<string, PaperLearningUiEvent>();
  for (const event of [...localEvents, ...events]) merged.set(event.id, Object.freeze({ ...event }));
  localEvents = Object.freeze([...merged.values()].sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id)).slice(0, MAX_LOCAL_EVENTS));
}

/**
 * Records only validated public-market observations that already passed the canonical Upbit
 * quotation parser. This is a read-only LOCAL PAPER projection, not a second execution engine.
 * It deliberately emits HOLD/SKIP when no governed PAPER decision exists instead of inventing
 * candidates, fills, PnL, or confidence.
 */
export function recordLocalPaperPublicMarkets(markets: readonly WatchlistMarket[]): void {
  const market = markets.find((candidate) => candidate.market === LOCAL_PAPER_MARKET);
  if (!market || !Number.isFinite(market.price) || market.price <= 0) return;
  const occurredAt = validObservedAt(market.observedAt);
  if (occurredAt === null) return;
  const cycleId = `local-public-${market.market}-${occurredAt}`;
  const identity = `${market.market}:${occurredAt}`;
  boundedAppend([
    Object.freeze({
      id: `${identity}:market`, cycleId, stage: "MARKET_DATA", occurredAt, market: market.market, status: "PASS",
      reason: "TRUSTED_UPBIT_PUBLIC_MARKET_OBSERVED", strategyId: LOCAL_OBSERVER_STRATEGY,
      evidence: Object.freeze({ evidenceId: `upbit-public:${identity}` }),
    }),
    Object.freeze({
      id: `${identity}:decision`, cycleId, stage: "DECISION", occurredAt: occurredAt + 1, market: market.market, status: "SKIP",
      reason: "LOCAL_PUBLIC_INPUT_READY_NO_GOVERNED_DECISION", strategyId: LOCAL_OBSERVER_STRATEGY,
      decision: Object.freeze({ action: "HOLD", allocation: 0, confidence: 1 }),
    }),
    Object.freeze({
      id: `${identity}:learning`, cycleId, stage: "LEARNING", occurredAt: occurredAt + 2, market: market.market, status: "SKIP",
      reason: "PUBLIC_INPUT_OBSERVED_NO_SIMULATED_MUTATION", strategyId: LOCAL_OBSERVER_STRATEGY,
      evidence: Object.freeze({ evidenceId: `local-paper-observation:${identity}`, outcome: "UNCHANGED" }),
    }),
  ]);
}

export function getLocalPaperLearningEvents(): readonly PaperLearningUiEvent[] {
  return localEvents;
}

/**
 * LOCAL PAPER readiness is derived from the last validated public observation, never from a
 * Cloud session or a private Upbit credential. A stale observation keeps the local pipeline
 * paused until the bounded public-feed refresh supplies a new value.
 */
export function getLocalPaperLearningReadiness(now = Date.now()): LocalPaperLearningReadiness {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("readiness clock must be a non-negative safe integer");
  const latest = localEvents.find((event) => event.stage === "MARKET_DATA" && event.status === "PASS");
  const lastObservedAt = latest?.occurredAt ?? null;
  if (lastObservedAt == null) return Object.freeze({ dataReady: false, status: "PAUSED", reason: "LOCAL_PUBLIC_MARKET_DATA_UNAVAILABLE", lastObservedAt: null });
  const age = now - lastObservedAt;
  if (age < 0 || age > LOCAL_PUBLIC_DATA_MAX_AGE_MS) return Object.freeze({ dataReady: false, status: "PAUSED", reason: "LOCAL_PUBLIC_MARKET_DATA_STALE", lastObservedAt });
  return Object.freeze({ dataReady: true, status: "RUNNING", reason: "LOCAL_PUBLIC_MARKET_DATA_READY", lastObservedAt });
}

export function resetLocalPaperLearningEventsForTest(): void {
  localEvents = Object.freeze([]);
}
