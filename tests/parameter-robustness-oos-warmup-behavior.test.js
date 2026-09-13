const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const backtestEngine = require("../dist/apps/desktop/src/strategy/backtestEngine.js");
const strategyEngine = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");

const candle = (index, close) => ({
  market: "KRW-BTC",
  interval: "1m",
  openTime: index * 60_000,
  closeTime: (index + 1) * 60_000,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1
});

const buildRequest = () => ({
  schemaVersion: 1,
  id: "parameter-robustness-oos-warmup-behavior",
  market: "KRW-BTC",
  candles: [100, 100, 100, 120, 120, 120, 120].map((close, index) => candle(index, close)),
  referenceParameters: [{ source: "PRODUCTION_DEFAULT", shortWindow: 2, longWindow: 3 }],
  neighborhood: { shortOffsets: [0], longOffsets: [0] },
  minimumTrades: 0,
  execution: {
    initialCash: 1_000,
    orderQuantity: 1,
    latencyCandles: 0,
    executionCosts: { spreadBps: 20 }
  },
  evaluation: {
    mode: "WALK_FORWARD_OOS_WINDOWS",
    oosWindows: { trainingCandles: 4, testCandles: 3, stepCandles: 3 }
  },
  costConditions: [
    { name: "BASE", feeRate: 0.01, slippageBps: 30 },
    { name: "MODERATE", feeRate: 0.01, slippageBps: 30 },
    { name: "SEVERE", feeRate: 0.01, slippageBps: 30 }
  ]
});

test("parameter robustness OOS preserves pre-test state without warm-up execution leakage", { concurrency: false }, () => {
  const originalRunBacktest = backtestEngine.runBacktest;
  const captures = [];
  backtestEngine.runBacktest = (...args) => {
    const result = originalRunBacktest(...args);
    captures.push({ points: args[0], factory: args[1], config: args[2], result });
    return result;
  };

  try {
    const output = runParameterRobustnessRequest(buildRequest(), { repositoryRoot });
    assert.equal(output.status, "PASS");
    assert.equal(captures.length, 3, "one OOS window must run once for each fixed cost condition");

    for (const capture of captures) {
      const { points, config, result } = capture;
      assert.equal(config.warmupPoints.length, 4);
      assert.equal(points.length, 3);
      assert.ok(config.warmupPoints.at(-1).timestamp < points[0].timestamp);

      // The scored window begins with already-initialized SMA state. A cold start at
      // the same observation would still be warming up, so this is behavioral proof
      // that strictly-prior history reached the real strategy instance.
      assert.equal(result.decisions[0].signal.reason, "no-cross");
      const cold = originalRunBacktest(
        points,
        () => new strategyEngine.SmaCrossoverStrategy(2, 3),
        { ...config, warmupPoints: undefined }
      );
      assert.equal(cold.decisions[0].signal.reason, "warming-up");

      // The final warm-up observation itself produces an actionable BUY if it is
      // scored. In the actual OOS run that signal must be discarded before broker,
      // pending-order, cost, PnL, or turnover state exists.
      const scoredWarmup = originalRunBacktest(
        config.warmupPoints,
        () => new strategyEngine.SmaCrossoverStrategy(2, 3),
        { ...config, warmupPoints: undefined }
      );
      assert.equal(scoredWarmup.decisions.at(-1).signal.type, "BUY");
      assert.equal(scoredWarmup.decisions.at(-1).outcome, "UNFILLED");
      assert.equal(result.metrics.fillCount, 0);
      assert.equal(result.metrics.rejectionCount, 0);
      assert.equal(result.metrics.totalReturn, 0);
      assert.equal(result.metrics.turnover, 0);
      assert.equal(result.metrics.feesPaid, 0);
      assert.equal(result.metrics.spreadCost, 0);
      assert.equal(result.metrics.slippageCost, 0);
      assert.equal(result.metrics.totalTradingCost, 0);
      assert.equal(result.decisions.some((decision) => decision.order != null), false);

      // Benchmark entry remains anchored to the first scored OOS close (120), not
      // any warm-up close (100). With a flat scored window, only declared entry
      // spread/slippage/fee costs can make buy-and-hold negative.
      const expectedBenchmarkReturn = 1 / ((1 + 0.004) * 1.01) - 1;
      assert.ok(Math.abs(result.metrics.benchmarkReturn - expectedBenchmarkReturn) < 1e-12);
    }
  } finally {
    backtestEngine.runBacktest = originalRunBacktest;
  }
});
