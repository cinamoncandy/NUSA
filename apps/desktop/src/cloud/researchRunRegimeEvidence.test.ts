import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHistoricalDatasetManifest, runWalkForwardExperiment, type ResearchCandle } from "./researchDataset";
import { buildMarketStateFrame } from "./marketStateFrame";
import { buildResearchRunRegimeEvaluation } from "./researchRunRegimeEvidence";
import { SmaCrossoverStrategy } from "../strategy/strategyEngine";

const DAY = 86_400_000;
function candles(count = 200, futureShock = false): ResearchCandle[] {
  return Array.from({ length: count }, (_, index) => {
    let close = 100 + index * 0.35 + Math.sin(index / 6) * 2;
    if (futureShock && index >= 120) close *= 0.35;
    const openTime = index * DAY;
    return { market: "KRW-BTC", interval: "1d", openTime, closeTime: openTime + DAY, open: close, high: close * 1.01, low: close * 0.99, close, volume: 10 + index };
  });
}
function manifestFor(values: readonly ResearchCandle[]) {
  return createHistoricalDatasetManifest(values, { source: "test", createdAt: "2026-08-26T00:00:00.000Z" });
}

describe("point-in-time research regime evidence", () => {
  it("does not allow candles after asOf to alter the market-state metrics", () => {
    const baseline = candles();
    const shocked = candles(200, true);
    const asOf = baseline[99]!.closeTime;
    const first = buildMarketStateFrame([{ manifest: manifestFor(baseline), candles: baseline }], { asOf, lookbackPeriods: 20 });
    const second = buildMarketStateFrame([{ manifest: manifestFor(shocked), candles: shocked }], { asOf, lookbackPeriods: 20 });
    assert.equal(first.markets[0]!.asOf, asOf);
    assert.equal(second.markets[0]!.asOf, asOf);
    assert.deepEqual(first.aggregate, second.aggregate);
    assert.equal(first.markets[0]!.lookbackReturn, second.markets[0]!.lookbackReturn);
    assert.equal(first.markets[0]!.realizedVolatility, second.markets[0]!.realizedVolatility);
  });

  it("builds provenance-bound regime evaluation and stays insufficient when regime diversity is thin", () => {
    const values = candles();
    const manifest = manifestFor(values);
    const experiment = runWalkForwardExperiment(
      { candles: values, manifest },
      [{ id: "sma-5-20", strategyFactory: () => new SmaCrossoverStrategy(5, 20), parameters: { shortPeriod: 5, longPeriod: 20 } }],
      { trainSize: 120, testSize: 20, minimumWindows: 2, backtestConfig: { market: "KRW-BTC", feeRate: 0.0005, orderQuantity: 0.001, executionCosts: { spreadBps: 5, slippageBps: 5 } }, selectionPolicy: { minimumClosedTrades: 0 } },
      { generatedAt: "2026-08-26T00:00:00.000Z" },
    );
    const evaluation = buildResearchRunRegimeEvaluation(experiment, [{ manifest, candles: values }], { lookbackPeriods: 20 });
    assert.equal(evaluation.datasetId, manifest.datasetId);
    assert.ok(evaluation.sourceDatasetIds.includes(manifest.datasetId));
    assert.equal(evaluation.slices.reduce((sum, slice) => sum + slice.windowCount, 0), experiment.walkForwardResult.windows.length);
    if (evaluation.sufficientRegimeCount < 2) {
      assert.equal(evaluation.regimeRobustnessScore, undefined);
      assert.ok(evaluation.reasons.includes("INSUFFICIENT_ROBUSTNESS_EVIDENCE"));
    }
  });

  it("fails closed when asOf precedes enough lookback history", () => {
    const values = candles(30);
    assert.throws(
      () => buildMarketStateFrame([{ manifest: manifestFor(values), candles: values }], { asOf: values[10]!.closeTime, lookbackPeriods: 20 }),
      (error: unknown) => error instanceof Error && error.message.includes("requires at least 21 candles"),
    );
  });
});
