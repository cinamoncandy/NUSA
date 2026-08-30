import assert from "node:assert/strict";
import test from "node:test";
import type { CioDecision } from "./cioDecisionEngine";
import { PaperAutoLearningRuntime } from "./paperAutoLearningRuntime";
import type { PaperAccountState, PaperExecutionTick, PaperTradingExecutionLoop } from "./paperTradingExecutionLoop";

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

function executionSpy(capture: { tick?: PaperExecutionTick }): PaperTradingExecutionLoop {
  return {
    snapshot: () => account,
    processTick: (tick: PaperExecutionTick) => {
      capture.tick = tick;
      return Object.freeze({ status: "WAIT" as const, reason: "test", orders: Object.freeze([]), fills: Object.freeze([]), state: account });
    },
  } as unknown as PaperTradingExecutionLoop;
}

const malformedDecision = Object.freeze({
  symbol: "KRW-BTC",
  action: "BUY",
  confidence: 0.8,
  risk: "LOW",
  allocation: 2,
  leverage: 1,
  score: 0.7,
  reasons: Object.freeze(["tampered allocation"]),
  decidedAt: 995,
}) as CioDecision;

test("autonomous PAPER runtime fails closed before execution on malformed decisions", () => {
  const capture: { tick?: PaperExecutionTick } = {};
  const runtime = new PaperAutoLearningRuntime({
    execution: executionSpy(capture),
    decisions: () => Object.freeze([malformedDecision]),
    control: () => Object.freeze({ killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" as const }),
  });

  const snapshot = runtime.onMarketObservation({ market: "KRW-BTC", price: 100, observedAt: 999, now: 1_000, trusted: true });

  assert.equal(snapshot.status, "ERROR");
  assert.equal(snapshot.lastReason, "PAPER_FAIL_CLOSED");
  assert.equal(snapshot.lastError, "PAPER_DECISION_ALLOCATION_INVALID");
  assert.equal(capture.tick, undefined);
  assert.equal(snapshot.account.orders.length, 0);
});
