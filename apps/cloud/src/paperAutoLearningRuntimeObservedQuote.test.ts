import assert from "node:assert/strict";
import test from "node:test";
import type { CioDecision } from "./cioDecisionEngine";
import { PaperAutoLearningRuntime } from "./paperAutoLearningRuntime";
import type { PaperAccountState, PaperExecutionTick, PaperTradingExecutionLoop } from "./paperTradingExecutionLoop";
import type { PaperObservedExecutionQuote } from "./paperRuntimeExecutionCostEvidence";

const account: PaperAccountState = Object.freeze({
  version: 1,
  initialCapital: 1_000_000,
  cash: 1_000_000,
  equity: 1_000_000,
  realizedPnL: 0,
  unrealizedPnL: 0,
  positions: Object.freeze([]),
  orders: Object.freeze([]),
  fills: Object.freeze([]),
  processedIdempotencyKeys: Object.freeze([]),
  updatedAt: 0,
});

const decision: CioDecision = Object.freeze({
  symbol: "KRW-BTC",
  action: "BUY",
  confidence: 0.8,
  risk: "LOW",
  allocation: 0.1,
  leverage: 1,
  score: 0.7,
  reasons: Object.freeze(["test"]),
  decidedAt: 995,
});

const quote: PaperObservedExecutionQuote = Object.freeze({
  schemaVersion: 1,
  source: "UPBIT_PUBLIC_ORDERBOOK",
  market: "KRW-BTC",
  observedAt: 998,
  bidPrice: 99,
  askPrice: 101,
  evidenceId: "quote:test",
  evidenceFingerprintSha256: "a".repeat(64),
  receipt: {} as PaperObservedExecutionQuote["receipt"],
});

function executionSpy(capture: { tick?: PaperExecutionTick }): PaperTradingExecutionLoop {
  return {
    snapshot: () => account,
    processTick: (tick: PaperExecutionTick) => {
      capture.tick = tick;
      return Object.freeze({ status: "WAIT" as const, reason: "test", orders: Object.freeze([]), fills: Object.freeze([]), state: account });
    },
  } as unknown as PaperTradingExecutionLoop;
}

test("forwards canonical observed quote into the autonomous PAPER execution boundary", () => {
  const capture: { tick?: PaperExecutionTick } = {};
  const runtime = new PaperAutoLearningRuntime({
    execution: executionSpy(capture),
    decisions: () => Object.freeze([decision]),
    control: () => Object.freeze({ killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" as const }),
  });

  const snapshot = runtime.onMarketObservation({ market: "krw-btc", price: 100, observedAt: 999, now: 1_000, trusted: true, observedQuote: quote });

  assert.equal(snapshot.status, "RUNNING");
  assert.equal(capture.tick?.market, "KRW-BTC");
  assert.equal(capture.tick?.observedQuote, quote);
});

test("fails closed before execution when observed quote belongs to another market", () => {
  const capture: { tick?: PaperExecutionTick } = {};
  const runtime = new PaperAutoLearningRuntime({
    execution: executionSpy(capture),
    decisions: () => Object.freeze([decision]),
    control: () => Object.freeze({ killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" as const }),
  });

  const snapshot = runtime.onMarketObservation({
    market: "KRW-ETH",
    price: 100,
    observedAt: 999,
    now: 1_000,
    trusted: true,
    observedQuote: quote,
  });

  assert.equal(snapshot.status, "ERROR");
  assert.equal(snapshot.lastError, "PAPER_OBSERVED_QUOTE_MARKET_MISMATCH");
  assert.equal(capture.tick, undefined);
});

test("fails closed before execution when observed quote is stale", () => {
  const capture: { tick?: PaperExecutionTick } = {};
  const runtime = new PaperAutoLearningRuntime({
    execution: executionSpy(capture),
    decisions: () => Object.freeze([decision]),
    control: () => Object.freeze({ killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" as const }),
    maxObservationAgeMs: 1_000,
  });

  const staleQuote = Object.freeze({ ...quote, observedAt: 0 });
  const snapshot = runtime.onMarketObservation({ market: "KRW-BTC", price: 100, observedAt: 999, now: 1_000, trusted: true, observedQuote: staleQuote });

  assert.equal(snapshot.status, "ERROR");
  assert.equal(snapshot.lastError, "PAPER_OBSERVED_QUOTE_STALE");
  assert.equal(capture.tick, undefined);
});
