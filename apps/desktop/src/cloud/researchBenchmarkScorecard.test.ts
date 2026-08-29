import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResearchBenchmarkScorecard } from "./researchBenchmarkScorecard";
import type { ResearchExperimentResult } from "./researchDataset";

function experiment(executionCosts: unknown): ResearchExperimentResult {
  return {
    manifest: {
      schemaVersion: 1,
      datasetId: "dataset-a",
      source: "test",
      market: "KRW-BTC",
      interval: "1d",
      candleCount: 200,
      startOpenTime: 0,
      endCloseTime: 172_800_000,
      timezone: "UTC",
      ordering: "OPEN_TIME_ASC",
      missingCandlePolicy: "REJECT",
      missingCandleCount: 0,
      createdAt: "1970-01-01T00:00:00.000Z",
      contentSha256: "a".repeat(64),
    },
    experimentConfig: {
      walkForward: {},
      candidates: [],
      executionCosts,
    },
    generatedAt: "1970-01-01T00:00:00.000Z",
    warnings: [],
    walkForwardResult: {
      windows: [],
      candidateSelectionCounts: {},
      warnings: [],
      stabilityDiagnostics: {
        candidates: [],
        selectionChurn: 0,
        selectionChurnRatio: 0.1,
      },
      combinedOutOfSampleMetrics: {
        windowCount: 2,
        totalOosPoints: 20,
        totalOosClosedTrades: 2,
        totalReturn: 0.05,
        maximumDrawdown: 0.1,
        turnover: 1,
        totalTradingCost: 100,
        profitableWindowRatio: 0.5,
        benchmarkOutperformanceWindowRatio: 0.5,
        equalWeight: {
          averageBenchmarkReturn: 0.01,
          averageOutperformance: 0.04,
        },
        sequentialCompounded: {
          initialEquity: 10_000,
        },
      },
    },
  } as unknown as ResearchExperimentResult;
}

function scorecardFor(executionCosts: unknown) {
  return createResearchBenchmarkScorecard([
    { id: "candidate-a", experiment: experiment(executionCosts) },
  ]);
}

describe("createResearchBenchmarkScorecard cost boundary", () => {
  it("retains scorecard evaluation when explicit execution costs are present", () => {
    const result = scorecardFor({ feeRate: 0.0005, spreadBps: 5, slippageBps: 5 });
    assert.equal(result.slices[0]?.eligible, true);
  });

  it("fails closed instead of treating missing execution costs as zero", () => {
    assert.throws(
      () => scorecardFor({ feeRate: 0.0005, spreadBps: 5 }),
      (error: unknown) => error instanceof Error
        && "code" in error
        && error.code === "MISSING_EXECUTION_COST_EVIDENCE",
    );
  });

  it("fails closed on non-finite execution cost evidence", () => {
    assert.throws(
      () => scorecardFor({ feeRate: Number.NaN, spreadBps: 5, slippageBps: 5 }),
      (error: unknown) => error instanceof Error
        && "code" in error
        && error.code === "MISSING_EXECUTION_COST_EVIDENCE",
    );
  });
});
