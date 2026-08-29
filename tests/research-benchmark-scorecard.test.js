"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchBenchmarkScorecard } = require("../dist/apps/desktop/src/cloud/researchBenchmarkScorecard.js");

function experiment(overrides = {}) {
  const market = overrides.market ?? "KRW-BTC";
  const interval = overrides.interval ?? "1d";
  const id = overrides.datasetId ?? `${market}-${interval}`;
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
      windows: [],
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
        windowCount: overrides.windowCount ?? 4,
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
        benchmarkOutperformanceWindowRatio: overrides.benchmarkOutperformanceWindowRatio ?? 0.75,
        equalWeight: {
          averageReturn: 0.03,
          averageBenchmarkReturn: overrides.averageBenchmarkReturn ?? 0.02,
          averageOutperformance: overrides.averageOutperformance ?? 0.01
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
    { id: "fragile", experiment: experiment({ windowCount: 1, totalOosPoints: 10, totalOosClosedTrades: 0, maximumDrawdown: 0.5, benchmarkOutperformanceWindowRatio: 0.25, selectionChurnRatio: 0.9 }) }
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
    "BENCHMARK_OUTPERFORMANCE_RATIO_NOT_MET",
    "SELECTION_CHURN_EXCEEDED"
  ]);
  assert.deepEqual(card.coverage.warnings, [
    "FEWER_THAN_THREE_RESEARCH_SLICES",
    "SINGLE_MARKET_COVERAGE",
    "SINGLE_INTERVAL_COVERAGE"
  ]);
});

test("supports explicit versioned research thresholds without changing defaults", () => {
  const weak = { id: "weak", experiment: experiment({ maximumDrawdown: 0.4, benchmarkOutperformanceWindowRatio: 0.4 }) };
  assert.equal(createResearchBenchmarkScorecard([weak]).slices[0].eligible, false);
  const relaxed = createResearchBenchmarkScorecard([weak], {
    maximumDrawdown: 0.5,
    minimumBenchmarkOutperformanceWindowRatio: 0.4
  });
  assert.equal(relaxed.slices[0].eligible, true);
  assert.equal(relaxed.policy.maximumDrawdown, 0.5);
});

test("rejects duplicate slice ids and invalid policy ratios", () => {
  const slice = { id: "dup", experiment: experiment() };
  assert.throws(() => createResearchBenchmarkScorecard([slice, slice]), /unique and non-empty/);
  assert.throws(() => createResearchBenchmarkScorecard([slice], { maximumDrawdown: 1.1 }), /between 0 and 1/);
});
