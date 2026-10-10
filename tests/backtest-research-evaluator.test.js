const test = require("node:test");
const assert = require("node:assert/strict");

const { BacktestResearchEvaluator, BacktestEvaluatorError, buildDonchianResearchStrategy, buildRsiResearchStrategy, buildSmaResearchStrategy } = require("../dist/apps/cloud/src/backtestResearchEvaluator.js");

const M = 60_000;
const BASE = { initialCash: 1_000_000, feeRate: 0.0005, slippageBps: 5 };
// A rising series, then a drop, then a rise again: enough for an SMA crossover to trade.
const closes = [...Array.from({ length: 30 }, (_, i) => 100 - i * 0.5), ...Array.from({ length: 40 }, (_, i) => 85 + i * 1.2), ...Array.from({ length: 20 }, (_, i) => 133 - i * 2), ...Array.from({ length: 40 }, (_, i) => 93 + i * 1.5)];
const rows = closes.map((close, i) => ({ closeTimeMs: (1000 + i) * M, open: close, high: close + 1, low: close - 1, close }));
const source = (data = rows) => ({ read: (market, interval, from, to) => data.filter((r) => r.closeTimeMs >= from && r.closeTimeMs <= to) });
const strategy = (fast = 3, slow = 8, id = "research-sma", version = "1.0.0") => buildSmaResearchStrategy({ strategyId: id, version, market: "KRW-BTC", fastPeriod: fast, slowPeriod: slow, takeProfitPercent: 5, stopLossPercent: 3, positionPercent: 50, maxPositionNotional: 500_000 });
const evaluator = (over = {}) => new BacktestResearchEvaluator({ strategyId: "research-sma", strategyVersion: "1.0.0", authority: "ZERO_AUTHORITY", evaluatorVersion: "eval-v1", strategy: strategy(), candles: source(), intervalMs: M, backtest: BASE, ...over });
const contextFor = (data = rows, over = {}) => ({
  input: { researchRunId: "r", evaluationId: "e", strategyId: "s", strategyVersion: "v", marketDataTimestamp: data.at(-1).closeTimeMs, evaluationTimestamp: data.at(-1).closeTimeMs + 1, modelVersion: "m", fillModelVersion: "f", feeModelVersion: "fee", slippageModelVersion: "sl", strategyState: "RESEARCHING", staleWindowMs: 10 * M, marketData: data.map((r) => ({ market: "KRW-BTC", price: r.close, observedAt: r.closeTimeMs })), startingCash: 1, startingPositionQuantity: 0, ...over },
  canonicalInputHash: "h".repeat(64), fillModelVersion: "f", feeModelVersion: "fee", slippageModelVersion: "sl",
});
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof BacktestEvaluatorError, String(e)); return e.code; } return "NO_ERROR"; };

test("evaluates a window with the DSL backtest and returns every metric the hardened comparison needs", () => {
  const result = evaluator().evaluate(contextFor());
  assert.equal(result.strategyId, "research-sma");
  assert.equal(result.authority, "ZERO_AUTHORITY");
  assert.equal(result.canonicalInputHash, "h".repeat(64));
  for (const key of ["netReturn", "costAdjustedReturn", "maximumDrawdown", "sharpeRatio", "executionQuality", "tradeCount"]) assert.ok(Number.isFinite(result.metrics[key]), key);
  assert.ok(result.metrics.executionQuality >= 0 && result.metrics.executionQuality <= 1);
  assert.ok(result.metrics.tradeCount >= 1, "the series should trigger at least one trade");
  assert.ok(["BUY", "SELL", "HOLD"].includes(result.signal));
});

test("is deterministic and different parameters give different results", () => {
  const a = evaluator().evaluate(contextFor());
  const b = evaluator().evaluate(contextFor());
  assert.deepEqual(a, b);
  const other = evaluator({ strategy: strategy(5, 20) }).evaluate(contextFor());
  assert.notDeepEqual(other.metrics, a.metrics);
});

test("fees and slippage are deducted: a costlier model never beats the cheaper one on the same data", () => {
  const cheap = evaluator({ backtest: { ...BASE, feeRate: 0, slippageBps: 0 } }).evaluate(contextFor());
  const costly = evaluator({ backtest: { ...BASE, feeRate: 0.002, slippageBps: 50 } }).evaluate(contextFor());
  assert.ok(costly.metrics.netReturn <= cheap.metrics.netReturn);
  assert.ok(costly.metrics.feesPaid >= cheap.metrics.feesPaid);
});

test("refuses unless the stored candles match the input point for point", () => {
  const missing = rows.filter((r) => r.closeTimeMs !== 1010 * M);
  assert.equal(code(() => evaluator({ candles: source(missing) }).evaluate(contextFor())), "CANDLE_COUNT_MISMATCH");
  const altered = rows.map((r) => (r.closeTimeMs === 1010 * M ? { ...r, close: r.close + 0.5 } : r));
  assert.equal(code(() => evaluator({ candles: source(altered) }).evaluate(contextFor())), "CANDLE_MISMATCH");
  const empty = contextFor(); empty.input.marketData = [];
  assert.equal(code(() => evaluator().evaluate(empty)), "NO_DATA");
  const mixed = contextFor(); mixed.input.marketData[3] = { ...mixed.input.marketData[3], market: "KRW-ETH" };
  assert.equal(code(() => evaluator().evaluate(mixed)), "MIXED_MARKETS");
});

test("cost, interval and cash must be explicit (no defaults)", () => {
  for (const backtest of [undefined, {}, { ...BASE, initialCash: 0 }, { ...BASE, feeRate: -1 }, { ...BASE, feeRate: 0.06 }, { ...BASE, slippageBps: 600 }, { initialCash: 1, feeRate: 0.001 }]) {
    assert.equal(code(() => evaluator({ backtest })), "INVALID_CONFIG");
  }
  assert.equal(code(() => evaluator({ intervalMs: 5 })), "INVALID_CONFIG");
});

test("the strategy builder validates and enforces the paper-only boundary", () => {
  const s = strategy();
  assert.equal(s.paperOnly, true);
  assert.equal(s.executionAllowed, false);
  assert.equal(s.productionMutationAllowed, false);
  assert.equal(s.status, "VALIDATED");
  assert.throws(() => buildSmaResearchStrategy({ strategyId: "x", version: "1.0.0", market: "KRW-BTC", fastPeriod: 8, slowPeriod: 3, takeProfitPercent: 5, stopLossPercent: 3, positionPercent: 50, maxPositionNotional: 1 }), BacktestEvaluatorError);
  assert.throws(() => buildSmaResearchStrategy({ strategyId: "x", version: "bad", market: "KRW-BTC", fastPeriod: 3, slowPeriod: 8, takeProfitPercent: 5, stopLossPercent: 3, positionPercent: 50, maxPositionNotional: 1 }), BacktestEvaluatorError);
});

test("the RSI mean-reversion family builds a valid DSL strategy and trades the oversold dip through the same evaluator", () => {
  const rsi = buildRsiResearchStrategy({ strategyId: "research-rsi", version: "1.0.0", market: "KRW-BTC", period: 7, threshold: 30, takeProfitPercent: 3, stopLossPercent: 2, timeoutMinutes: 48, positionPercent: 50, maxPositionNotional: 500_000 });
  assert.equal(rsi.dsl.entry.type, "RSI_THRESHOLD");
  assert.deepEqual(rsi.dsl.exits.map((e) => e.type), ["TAKE_PROFIT", "STOP_LOSS", "TIMEOUT"]);
  assert.equal(rsi.paperOnly, true);
  assert.equal(rsi.executionAllowed, false);
  const result = evaluator({ strategyId: "research-rsi", strategy: rsi }).evaluate(contextFor());
  for (const key of ["netReturn", "costAdjustedReturn", "maximumDrawdown", "sharpeRatio", "executionQuality", "tradeCount"]) assert.ok(Number.isFinite(result.metrics[key]), key);
  assert.ok(result.metrics.tradeCount >= 1, "the falling stretch drives RSI below 30 at least once");
  assert.equal(code(() => buildRsiResearchStrategy({ strategyId: "x", version: "1", market: "KRW-BTC", period: 7, threshold: 120, takeProfitPercent: 3, stopLossPercent: 2, timeoutMinutes: 48, positionPercent: 50, maxPositionNotional: 1 })), "STRATEGY_INVALID", "an impossible threshold is rejected");
});

test("the Donchian breakout family builds a valid DSL strategy and trades a breakout through the same evaluator", () => {
  const donchian = buildDonchianResearchStrategy({ strategyId: "research-donchian", version: "1.0.0", market: "KRW-BTC", period: 10, takeProfitPercent: 3, stopLossPercent: 2, timeoutMinutes: 12, positionPercent: 50, maxPositionNotional: 500_000 });
  assert.equal(donchian.dsl.entry.type, "DONCHIAN_BREAKOUT");
  assert.deepEqual(donchian.dsl.exits.map((e) => e.type), ["TAKE_PROFIT", "STOP_LOSS", "TIMEOUT"]);
  assert.equal(donchian.paperOnly, true);
  assert.equal(donchian.executionAllowed, false);
  const result = evaluator({ strategyId: "research-donchian", strategy: donchian }).evaluate(contextFor());
  for (const key of ["netReturn", "costAdjustedReturn", "maximumDrawdown", "sharpeRatio", "executionQuality", "tradeCount"]) assert.ok(Number.isFinite(result.metrics[key]), key);
  assert.ok(result.metrics.tradeCount >= 1, "the rising stretch breaks the 10-bar channel at least once");
  assert.equal(code(() => buildDonchianResearchStrategy({ strategyId: "x", version: "1", market: "KRW-BTC", period: 1, takeProfitPercent: 3, stopLossPercent: 2, timeoutMinutes: 12, positionPercent: 50, maxPositionNotional: 1 })), "STRATEGY_INVALID", "a one-bar channel is rejected");
});
