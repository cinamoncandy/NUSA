import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateStrategyByRegime, RegimeAwareEvaluationError } from "./regimeAwareStrategyEvaluation";
import type { ResearchExperimentResult } from "./researchDataset";
import { assessRegimeHealth, type RegimeHealthAssessment } from "./regimeHealth";
import type { MarketStateFrame } from "./marketStateFrame";

function experiment(): ResearchExperimentResult {
  const makeWindow = (index: number, totalReturn: number, outperformance: number, drawdown: number, cost: number) => ({
    window: {
      index,
      trainStart: index * 10,
      trainEnd: index * 10 + 4,
      testStart: index * 10 + 5,
      testEnd: index * 10 + 9,
      trainPoints: [{ timestamp: index * 1_000 + 100, close: 100 }],
      testPoints: [{ timestamp: index * 1_000 + 500, close: 100 }, { timestamp: index * 1_000 + 600, close: 101 }],
    },
    selectedCandidateId: "candidate-a",
    trainResult: {},
    candidateTrainScores: [],
    selectionReason: "test",
    testResult: {
      metrics: { totalReturn, maxDrawdown: drawdown, totalTradingCost: cost, initialEquity: 1_000 },
      benchmark: { outperformance },
      performance: { trades: 2 },
    },
  });

  return {
    manifest: {
      schemaVersion: 1,
      datasetId: "dataset-a",
      source: "fixture",
      market: "KRW-BTC",
      interval: "60m",
      candleCount: 100,
      startOpenTime: 0,
      endCloseTime: 100_000,
      timezone: "UTC",
      ordering: "OPEN_TIME_ASC",
      missingCandlePolicy: "REJECT",
      missingCandleCount: 0,
      createdAt: "2026-08-26T00:00:00.000Z",
      contentSha256: "a".repeat(64),
    },
    experimentConfig: { walkForward: { trainSize: 5, testSize: 2 }, candidates: [{ id: "candidate-a" }], executionCosts: {} },
    walkForwardResult: {
      windows: [
        makeWindow(0, 0.04, 0.02, 0.03, 1),
        makeWindow(1, 0.03, 0.01, 0.04, 1),
        makeWindow(2, -0.02, -0.01, 0.08, 2),
        makeWindow(3, -0.01, 0, 0.07, 2),
      ],
      combinedOutOfSampleMetrics: {} as never,
      candidateSelectionCounts: { "candidate-a": 4 },
      stabilityDiagnostics: {} as never,
      warnings: [],
    },
    generatedAt: "2026-08-26T00:00:00.000Z",
    warnings: [],
  } as unknown as ResearchExperimentResult;
}

function regime(windowIndex: number, state: RegimeHealthAssessment["state"], overrides: Partial<RegimeHealthAssessment> = {}): { windowIndex: number; regime: RegimeHealthAssessment } {
  const firstOosTimestamp = windowIndex * 1_000 + 500;
  return {
    windowIndex,
    regime: {
      schemaVersion: 1,
      asOf: firstOosTimestamp - 1,
      state,
      score: state === "HEALTHY" ? 0.8 : state === "MIXED" ? 0.5 : 0.2,
      components: { breadth: 0.5, medianReturn: 0, medianDrawdown: -0.05, medianVolatility: 0.02, dispersion: 0.01 },
      reasons: [],
      sourceDatasetIds: ["dataset-a"],
      ...overrides,
    },
  };
}

function staggeredRegimeFrame(): MarketStateFrame {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-26T00:00:00.000Z",
    lookbackPeriods: 20,
    markets: [
      {
        market: "KRW-BTC",
        interval: "60m",
        datasetId: "dataset-a",
        asOf: 400,
        lastClose: 100,
        onePeriodReturn: 0.01,
        lookbackReturn: 0.02,
        realizedVolatility: 0.01,
        maxDrawdown: -0.02,
        averageVolume: 1,
      },
      {
        market: "KRW-ETH",
        interval: "60m",
        datasetId: "dataset-b",
        asOf: 501,
        lastClose: 100,
        onePeriodReturn: 0.01,
        lookbackReturn: 0.02,
        realizedVolatility: 0.01,
        maxDrawdown: -0.02,
        averageVolume: 1,
      },
    ],
    aggregate: {
      marketCount: 2,
      positiveBreadth: 1,
      medianLookbackReturn: 0.02,
      medianRealizedVolatility: 0.01,
      crossSectionalDispersion: 0,
    },
    sourceDatasetIds: ["dataset-a", "dataset-b"],
  };
}

describe("evaluateStrategyByRegime", () => {
  it("aggregates OOS performance by point-in-time regime and exposes robustness", () => {
    const result = evaluateStrategyByRegime(experiment(), [
      regime(0, "HEALTHY"),
      regime(1, "HEALTHY"),
      regime(2, "STRESSED"),
      regime(3, "STRESSED"),
    ]);

    const healthy = result.slices.find((slice) => slice.regime === "HEALTHY")!;
    const stressed = result.slices.find((slice) => slice.regime === "STRESSED")!;
    assert.equal(healthy.windowCount, 2);
    assert.equal(healthy.sufficientEvidence, true);
    assert.ok(healthy.averageReturn! > 0);
    assert.equal(stressed.windowCount, 2);
    assert.ok(stressed.averageReturn! < 0);
    assert.equal(result.sufficientRegimeCount, 2);
    assert.ok(result.regimeRobustnessScore != null);
    assert.deepEqual(result.sourceDatasetIds, ["dataset-a"]);
  });

  it("marks a regime insufficient instead of fabricating robustness from one window", () => {
    const result = evaluateStrategyByRegime(experiment(), [
      regime(0, "HEALTHY"),
      regime(1, "MIXED"),
      regime(2, "STRESSED"),
      regime(3, "STRESSED"),
    ], { minimumWindowsPerRegime: 2 });
    const healthy = result.slices.find((slice) => slice.regime === "HEALTHY")!;
    assert.equal(healthy.sufficientEvidence, false);
    assert.ok(healthy.reasons.includes("INSUFFICIENT_REGIME_WINDOWS"));
  });

  it("fails closed when regime evidence is at or after the first OOS timestamp", () => {
    assert.throws(
      () => evaluateStrategyByRegime(experiment(), [
        regime(0, "HEALTHY", { asOf: 500 }),
        regime(1, "HEALTHY"),
        regime(2, "STRESSED"),
        regime(3, "STRESSED"),
      ]),
      (error: unknown) => error instanceof RegimeAwareEvaluationError && error.code === "LOOKAHEAD_REGIME_EVIDENCE",
    );
  });

  it("uses the latest constituent timestamp for aggregate regime availability", () => {
    const assessed = assessRegimeHealth(staggeredRegimeFrame());
    assert.equal(assessed.asOf, 501);
    assert.throws(
      () => evaluateStrategyByRegime(experiment(), [
        { windowIndex: 0, regime: assessed },
        regime(1, "HEALTHY"),
        regime(2, "STRESSED"),
        regime(3, "STRESSED"),
      ]),
      (error: unknown) => error instanceof RegimeAwareEvaluationError && error.code === "LOOKAHEAD_REGIME_EVIDENCE",
    );
  });

  it("fails closed on missing, duplicate, or unrelated regime evidence", () => {
    assert.throws(() => evaluateStrategyByRegime(experiment(), [regime(0, "HEALTHY")]), RegimeAwareEvaluationError);
    assert.throws(() => evaluateStrategyByRegime(experiment(), [regime(0, "HEALTHY"), regime(0, "HEALTHY"), regime(2, "STRESSED"), regime(3, "STRESSED")]), RegimeAwareEvaluationError);
    assert.throws(() => evaluateStrategyByRegime(experiment(), [
      regime(0, "HEALTHY", { sourceDatasetIds: ["other-dataset"] }),
      regime(1, "HEALTHY"),
      regime(2, "STRESSED"),
      regime(3, "STRESSED"),
    ]), RegimeAwareEvaluationError);
  });

  it("emits research evidence only, never execution authority fields", () => {
    const result = evaluateStrategyByRegime(experiment(), [regime(0, "HEALTHY"), regime(1, "HEALTHY"), regime(2, "STRESSED"), regime(3, "STRESSED")]);
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["broker", "order", "liveauthority", "withdraw", "transfer", "notional", "capitalamount"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });
});
