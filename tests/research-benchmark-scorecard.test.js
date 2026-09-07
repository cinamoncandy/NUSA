"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchBenchmarkScorecard } = require("../dist/apps/desktop/src/cloud/researchBenchmarkScorecard.js");

function experiment(overrides = {}) {
  const market = overrides.market ?? "KRW-BTC";
  const interval = overrides.interval ?? "1d";
  const id = overrides.datasetId ?? `${market}-${interval}`;
  const windowCount = overrides.windowCount ?? 4;
  const averageBenchmarkReturn = overrides.averageBenchmarkReturn ?? 0.02;
  const averageOutperformance = overrides.averageOutperformance ?? 0.01;
  const strategyReturn = averageBenchmarkReturn + averageOutperformance;
  const windows = Array.from({ length: windowCount }, (_, index) => ({
    window: {
      index,
      trainStart: index * 10,
      trainEnd: index * 10 + 4,
      testStart: index * 10 + 5,
      testEnd: index * 10 + 9,
      trainPoints: [{ timestamp: index * 1_000 + 100, close: 100 }],
      testPoints: [{ timestamp: index * 1_000 + 500, close: 100 }]
    },
    selectedCandidateId: "candidate-a",
    trainResult: {},
    candidateTrainScores: [],
    selectionReason: "fixture",
    testResult: {
      metrics: {
        totalReturn: strategyReturn,
        benchmarkReturn: averageBenchmarkReturn,
        excessReturn: averageOutperformance,
        outperformance: averageOutperformance,
        maxDrawdown: 0.05,
        totalTradingCost: 1,
        initialEquity: 10_000_000
      },
      benchmark: {
        strategyReturn,
        buyAndHoldReturn: averageBenchmarkReturn,
        outperformance: averageOutperformance
      },
      performance: { trades: 2 }
    }
  }));
  if (overrides.mutateWindowBenchmark) overrides.mutateWindowBenchmark(windows);
  return {
    manifest: {
      schemaVersion: 1,
      datasetId: id,
      source: "fixture",
      market,
      interval,
      candleCount: overrides.candleCount ?? 200,
      startOpenTime: 0,
      endCloseTime: 1,
      timezone: "UTC",
      ordering: "OPEN_TIME_ASC",
      missingCandlePolicy: "REJECT",
      missingCandleCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      contentSha256: overrides.contentSha256 ?? `sha-${id}`
    },
    experimentConfig: { walkForward: {}, candidates: [], executionCosts: { feeRate: 0.0005, spreadBps: 5, slippageBps: 5 } },
    generatedAt: "2026-01-01T00:00:00.000Z",
    warnings: [],
    walkForwardResult: {
      windows,
      candidateSelectionCounts: {},
      warnings: [],
      stabilityDiagnostics: {
        candidates: [],
        selectionChurn: 0,
        selectionChurnRatio: overrides.selectionChurnRatio ?? 0.2
      },
      combinedOutOfSampleMetrics: {
        closedTradeNetProfit: 0,
        markedTotalReturn: overrides.totalReturn ?? 0.12,
        markedMaximumDrawdown: overrides.maximumDrawdown ?? 0.1,
        windowCount,
        totalOosPoints: overrides.totalOosPoints ?? 80,
        totalOosClosedTrades: overrides.totalOosClosedTrades ?? 8,
        netProfit: 0,
        totalReturn: overrides.totalReturn ?? 0.12,
        maximumDrawdown: overrides.maximumDrawdown ?? 0.1,
        winRate: 0.5,
        turnover: overrides.turnover ?? 1.5,
        exposure: 0.5,
        fees: 1000,
        spreadCost: 1000,
        slippageCost: 1000,
        totalTradingCost: overrides.totalTradingCost ?? 3000,
        profitableWindowRatio: overrides.profitableWindowRatio ?? 0.75,
        positiveExpectancyWindowRatio: 0.75,
        benchmarkOutperformanceWindowRatio: overrides.benchmarkOutperformanceWindowRatio ?? (averageOutperformance > 0 ? 1 : 0),
        equalWeight: {
          averageReturn: strategyReturn,
          averageBenchmarkReturn,
          averageOutperformance
        },
        sequentialCompounded: {
          initialEquity: overrides.initialEquity ?? 10_000_000,
          finalEquity: 11_200_000,
          totalReturn: overrides.totalReturn ?? 0.12,
          maximumDrawdown: overrides.maximumDrawdown ?? 0.1
        }
      }
    }
  };
}

test("ranks eligible slices deterministically and preserves provenance", () => {
  const card = createResearchBenchmarkScorecard([
    { id: "eth", experiment: experiment({ market: "KRW-ETH", interval: "60m", totalReturn: 0.08, datasetId: "eth-set" }) },
    { id: "btc", experiment: experiment({ market: "KRW-BTC", interval: "1d", totalReturn: 0.15, datasetId: "btc-set", contentSha256: "abc123" }) },
    { id: "xrp", experiment: experiment({ market: "KRW-XRP", interval: "1d", totalReturn: 0.1, datasetId: "xrp-set" }) }
  ]);

  assert.equal(card.coverage.sliceCount, 3);
  assert.deepEqual(card.coverage.markets, ["KRW-BTC", "KRW-ETH", "KRW-XRP"]);
  assert.deepEqual(card.coverage.intervals, ["1d", "60m"]);
  assert.deepEqual(card.coverage.warnings, []);
  assert.equal(card.slices[0].id, "btc");
  assert.equal(card.slices[0].rank, 1);
  assert.equal(card.slices[0].datasetId, "btc-set");
  assert.equal(card.slices[0].contentSha256, "abc123");
  assert.equal(card.slices[0].eligible, true);
});

test("keeps ineligible evidence visible with fail-closed reasons", () => {
  const card = createResearchBenchmarkScorecard([
    { id: "fragile", experiment: experiment({ windowCount: 1, totalOosPoints: 10, totalOosClosedTrades: 0, maximumDrawdown: 0.5, benchmarkOutperformanceWindowRatio: 1, selectionChurnRatio: 0.9 }) }
  ]);
  const score = card.slices[0];
  assert.equal(score.eligible, false);
  assert.equal(score.rank, undefined);
  assert.equal(score.researchScore, undefined);
  assert.deepEqual(score.reasons, [
    "MINIMUM_WINDOWS_NOT_MET",
    "MINIMUM_OOS_POINTS_NOT_MET",
    "MINIMUM_CLOSED_TRADES_NOT_MET",
    "MAXIMUM_DRAWDOWN_EXCEEDED",
    "SELECTION_CHURN_EXCEEDED"
  ]);
  assert.deepEqual(card.coverage.warnings, [
    "FEWER_THAN_THREE_RESEARCH_SLICES",
    "SINGLE_MARKET_COVERAGE",
    "SINGLE_INTERVAL_COVERAGE"
  ]);
});

test("supports explicit versioned research thresholds without changing defaults", () => {
  const weak = { id: "weak", experiment: experiment({ maximumDrawdown: 0.4, averageOutperformance: -0.01, benchmarkOutperformanceWindowRatio: 0 }) };
  assert.equal(createResearchBenchmarkScorecard([weak]).slices[0].eligible, false);
  const relaxed = createResearchBenchmarkScorecard([weak], {
    maximumDrawdown: 0.5,
    minimumBenchmarkOutperformanceWindowRatio: 0
  });
  assert.equal(relaxed.slices[0].eligible, true);
  assert.equal(relaxed.policy.maximumDrawdown, 0.5);
});

test("rejects malformed aggregate evidence before ranking", () => {
  assert.throws(
    () => createResearchBenchmarkScorecard([
      { id: "nan-return", experiment: experiment({ totalReturn: Number.NaN }) }
    ]),
    /totalReturn must be finite/
  );
  assert.throws(
    () => createResearchBenchmarkScorecard([
      { id: "fractional-count", experiment: experiment({ totalOosPoints: 1.5 }) }
    ]),
    /totalOosPoints must be a non-negative integer/
  );
  assert.throws(
    () => createResearchBenchmarkScorecard([
      { id: "empty-equity", experiment: experiment({ initialEquity: 0 }) }
    ]),
    /initialEquity must be positive and finite/
  );
});

test("rejects benchmark substitution inside an OOS window", () => {
  const tampered = experiment({
    mutateWindowBenchmark(windows) {
      windows[0].testResult.benchmark.buyAndHoldReturn = -0.5;
    }
  });
  assert.throws(
    () => createResearchBenchmarkScorecard([{ id: "tampered-window", experiment: tampered }]),
    /benchmark identity mismatch in OOS window/
  );
});

test("rejects favorable aggregate benchmark rewriting", () => {
  const tampered = experiment();
  tampered.walkForwardResult.combinedOutOfSampleMetrics.equalWeight.averageBenchmarkReturn = -0.5;
  assert.throws(
    () => createResearchBenchmarkScorecard([{ id: "tampered-aggregate", experiment: tampered }]),
    /benchmark aggregate evidence does not match OOS windows/
  );
});

test("rejects missing OOS benchmark provenance windows", () => {
  const tampered = experiment();
  tampered.walkForwardResult.windows.pop();
  assert.throws(
    () => createResearchBenchmarkScorecard([{ id: "missing-window", experiment: tampered }]),
    /benchmark window evidence count does not match aggregate windowCount/
  );
});

test("rejects duplicate slice ids and invalid policy ratios", () => {
  const slice = { id: "dup", experiment: experiment() };
  assert.throws(() => createResearchBenchmarkScorecard([slice, slice]), /unique and non-empty/);
  assert.throws(() => createResearchBenchmarkScorecard([slice], { maximumDrawdown: 1.1 }), /between 0 and 1/);
});
