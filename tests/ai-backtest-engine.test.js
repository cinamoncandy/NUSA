const test = require("node:test");
const assert = require("node:assert/strict");
const { parseNaturalLanguageStrategy, validateStrategy, StrategyRegistry } = require("../dist/apps/mobile/src/aiStrategyEngine.js");
const { runDslBacktest, InMemoryBacktestResultRepository, serializeBacktestReport, restoreBacktestReport } = require("../dist/apps/mobile/src/aiBacktestEngine.js");

const dataset = { version: "paper-dataset-v1", checksum: "a".repeat(64) };
const source = "Buy when price above 100 on KRW-BTC in sideways, take profit 5%, stop loss 2%, risk 1%, position size 10%, max position 100000";
const strategy = () => {
  const parsed = parseNaturalLanguageStrategy(source, { strategyId: "price-breakout", version: "1.0.0", now: 1, datasetVersion: dataset.version, datasetChecksum: dataset.checksum });
  assert.equal(parsed.status, "DRAFT");
  const validation = validateStrategy(parsed.strategy);
  assert.equal(validation.status, "VALIDATED");
  return validation.strategy;
};
const registry = () => { const value = new StrategyRegistry(); const registered = value.register(strategy()); return { value, registered }; };
const candle = (timestamp, close, high = close, low = close) => ({ timestamp, open: close, high, low, close, volume: 1 });

test("executes registered DSL strategy without looking ahead", () => {
  const { value, registered } = registry();
  const candles = [candle(1_000, 90), candle(2_000, 99), candle(3_000, 101), candle(4_000, 107, 107, 100)];
  const report = runDslBacktest({ candles, dataset, strategy: registered, registry: value, config: { initialCash: 1_000, feeRate: 0.01, slippageBps: 10 } });
  assert.deepEqual(report.decisions.map((decision) => decision.action), ["HOLD", "HOLD", "ENTRY", "EXIT"]);
  assert.deepEqual(report.decisions.map((decision) => decision.dataThroughTimestamp), candles.map((item) => item.timestamp));
  assert.equal(report.safety.lookAheadSafe, true);
  assert.equal(report.safety.liveMutationAllowed, false);
  assert.equal(report.trades.length, 1);
  assert.equal(report.metrics.tradeCount, 1);
  assert.ok(report.metrics.feesPaid > 0);
  assert.ok(report.metrics.slippageCost > 0);
  assert.equal(report.metrics.profitFactor, null);
});

test("applies stop loss, risk sizing and deterministic metrics", () => {
  const { value, registered } = registry();
  const candles = [candle(1_000, 90), candle(2_000, 101), candle(3_000, 98, 101, 98)];
  const input = { candles, dataset, strategy: registered, registry: value, config: { initialCash: 1_000, feeRate: 0, slippageBps: 0 } };
  const first = runDslBacktest(input);
  const second = runDslBacktest(input);
  assert.deepEqual(second, first);
  assert.equal(first.decisions[2].reason, "STOP_LOSS");
  assert.ok(first.trades[0].netPnl < 0);
  assert.equal(first.metrics.winRate, 0);
  assert.equal(first.metrics.maxDrawdown > 0, true);
  assert.equal(first.metrics.cagr !== null, true);
  assert.ok(first.fills[0].quantity * first.fills[0].price <= 500.0000001);
});

test("fails closed for unregistered strategies and provenance or dataset errors", () => {
  const { value, registered } = registry();
  const candles = [candle(1_000, 90), candle(2_000, 101)];
  assert.throws(() => runDslBacktest({ candles, dataset: { ...dataset, version: "other" }, strategy: registered, registry: value }), /DATASET_PROVENANCE_MISMATCH/);
  const emptyRegistry = new StrategyRegistry();
  assert.throws(() => runDslBacktest({ candles, dataset, strategy: registered, registry: emptyRegistry }), /STRATEGY_NOT_REGISTERED/);
  assert.throws(() => runDslBacktest({ candles, dataset: { version: "v", checksum: "bad" }, strategy: registered, registry: value }), /SHA-256/);
  assert.throws(() => runDslBacktest({ candles: [candle(2_000, 100), candle(1_000, 101)], dataset, strategy: registered, registry: value }), /strictly increasing/);
});

test("persists and restores an integrity-checked report", () => {
  const { value, registered } = registry();
  const report = runDslBacktest({ candles: [candle(1_000, 90), candle(2_000, 101), candle(3_000, 107, 107, 100)], dataset, strategy: registered, registry: value, config: { initialCash: 1_000 } });
  const repository = new InMemoryBacktestResultRepository();
  repository.save(report);
  assert.deepEqual(repository.load(report.reportId), report);
  const serialized = serializeBacktestReport(report);
  assert.deepEqual(restoreBacktestReport(serialized), report);
  const tampered = serialized.replace("paper-dataset-v1", "paper-dataset-v2");
  assert.throws(() => restoreBacktestReport(tampered), /INTEGRITY_FAILURE/);
});

const donchian = (period) => {
  const draft = { strategyId: `donchian-${period}`, name: `Donchian ${period}`, version: "1.0.0", status: "VALIDATED", dsl: { entry: { type: "DONCHIAN_BREAKOUT", period }, exits: [{ type: "TAKE_PROFIT", percent: 50 }, { type: "STOP_LOSS", percent: 50 }], risk: { positionSize: { mode: "PERCENT_OF_EQUITY", value: 50 }, maxRiskPercent: 50, maxPositionNotional: 1_000_000 }, scope: { symbols: ["KRW-BTC"], regimes: ["ANY"] } }, evidence: { sourceText: "donchian test", generationReasons: ["test"], datasetVersion: dataset.version, datasetChecksum: dataset.checksum }, createdAt: 1, paperOnly: true, productionMutationAllowed: false, executionAllowed: false };
  const validated = validateStrategy(draft);
  assert.equal(validated.status, "VALIDATED", validated.errors.join(","));
  return validated.strategy;
};
const runDonchian = (period, candles) => {
  const value = new StrategyRegistry();
  const registered = value.register(donchian(period));
  return runDslBacktest({ candles, dataset, strategy: registered, registry: value, config: { initialCash: 1_000, feeRate: 0.0005, slippageBps: 5 } });
};

test("a Donchian breakout enters only when the close beats the previous N highs, never the current bar's own high", () => {
  // Highs 100,101,102; bar 3 closes at 103 > max(previous 3 highs = 102): entry. Bar 4 closes at 102.5, below its own previous highs.
  const candles = [candle(1_000, 99, 100), candle(2_000, 100, 101), candle(3_000, 101, 102), candle(4_000, 103, 105), candle(5_000, 102.5, 104)];
  const report = runDonchian(3, candles);
  assert.deepEqual(report.decisions.map((d) => d.action).slice(0, 4), ["HOLD", "HOLD", "HOLD", "ENTRY"]);
  assert.equal(report.safety.lookAheadSafe, true);
  // A bar whose own high is the new extreme but whose close is not above the previous highs does not enter.
  const spike = [candle(1_000, 99, 100), candle(2_000, 100, 101), candle(3_000, 101, 102), candle(4_000, 101.5, 110)];
  assert.ok(runDonchian(3, spike).decisions.every((d) => d.action === "HOLD"), "a long wick above the channel is not a breakout; only the close counts");
});

test("a Donchian breakout needs a full lookback before it can fire, and the period is validated", () => {
  const short = [candle(1_000, 99, 100), candle(2_000, 120, 130)];
  assert.ok(runDonchian(3, short).decisions.every((d) => d.action === "HOLD"), "fewer than `period` previous bars means no signal");
  for (const period of [1, 0, 2.5, 501, -3, Number.NaN]) {
    const bad = { strategyId: "bad", name: "bad", version: "1.0.0", status: "VALIDATED", dsl: { entry: { type: "DONCHIAN_BREAKOUT", period }, exits: [{ type: "TAKE_PROFIT", percent: 5 }, { type: "STOP_LOSS", percent: 2 }], risk: { positionSize: { mode: "PERCENT_OF_EQUITY", value: 10 }, maxRiskPercent: 2, maxPositionNotional: 1000 }, scope: { symbols: ["KRW-BTC"], regimes: ["ANY"] } }, evidence: { sourceText: "x", generationReasons: ["x"] }, createdAt: 1, paperOnly: true, productionMutationAllowed: false, executionAllowed: false };
    const result = validateStrategy(bad);
    assert.notEqual(result.status, "VALIDATED", `period ${period} must be rejected`);
    assert.ok(result.errors.includes("DONCHIAN_RULE_INVALID"), `period ${period}`);
  }
});
