const test = require("node:test");
const assert = require("node:assert/strict");
const { buildParameterRobustnessRequest } = require("../scripts/research-real-market-run.js");

const manifest = {
  market: "KRW-BTC",
  datasetId: "upbit-days-example",
  contentSha256: "a".repeat(64)
};
const candles = [{
  market: "KRW-BTC",
  interval: "1d",
  openTime: 1,
  closeTime: 86_401_000,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1
}];

test("canonical real-market run builds fixed parameter robustness evidence from its manifest and candles", () => {
  const first = buildParameterRobustnessRequest({ candles, manifest });
  const second = buildParameterRobustnessRequest({ candles, manifest });

  assert.deepEqual(first, second);
  assert.equal(first.id, "real-run:upbit-days-example:parameter-robustness");
  assert.equal(first.market, "KRW-BTC");
  assert.strictEqual(first.candles, candles);
  assert.deepEqual(first.referenceParameters, [
    {
      source: "PRODUCTION_DEFAULT",
      shortWindow: 5,
      longWindow: 20
    },
    {
      source: "MANUAL_RESEARCH_REFERENCE",
      shortWindow: 2,
      longWindow: 8
    }
  ]);
  assert.deepEqual(first.neighborhood, {
    shortOffsets: [-2, -1, 0, 1, 2],
    longOffsets: [-5, -2, 0, 2, 5]
  });
  assert.equal(first.execution.initialCash, 10_000_000);
  assert.equal(first.execution.orderQuantity, 0.001);
  assert.equal(first.execution.executionCosts.spreadBps, 5);
  assert.deepEqual(first.evaluation, {
    mode: "BOTH",
    oosWindows: {
      trainingCandles: 120,
      testCandles: 20,
      stepCandles: 20
    }
  });
  assert.deepEqual(first.costConditions, [
    { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
    { name: "MODERATE", feeRate: 0.00075, slippageBps: 10 },
    { name: "SEVERE", feeRate: 0.001, slippageBps: 30 }
  ]);
});

test("parameter robustness request refuses missing canonical source inputs", () => {
  assert.throws(
    () => buildParameterRobustnessRequest({ candles: [], manifest }),
    /canonical candles/
  );
  assert.throws(
    () => buildParameterRobustnessRequest({ candles, manifest: { market: "KRW-BTC" } }),
    /canonical dataset manifest/
  );
});


test("canonical RSI robustness request is the precommitted 3x3 grid with explicit adjacency", () => {
  const request = buildParameterRobustnessRequest({ candles, manifest, strategyFamily: "rsi-mean-reversion" });
  assert.equal(request.strategyFamily, "rsi-mean-reversion");
  assert.equal(request.candidateGrid.length, 9);
  assert.deepEqual(request.referenceParameters, [
    { source: "PRODUCTION_DEFAULT", candidateKey: "rsi-14-30-70", parameters: { period: 14, oversold: 30, overbought: 70 } },
    { source: "MANUAL_RESEARCH_REFERENCE", candidateKey: "rsi-7-25-75", parameters: { period: 7, oversold: 25, overbought: 75 } }
  ]);
  const center = request.candidateGrid.find((entry) => entry.key === "rsi-14-30-70");
  assert.deepEqual(center.neighbors, ["rsi-14-25-75", "rsi-14-35-65", "rsi-21-30-70", "rsi-7-30-70"]);
  assert.ok(request.candidateGrid.every(Object.isFrozen));
});


test("canonical Donchian robustness request is the precommitted five-period line with explicit adjacency", () => {
  const request = buildParameterRobustnessRequest({ candles, manifest, strategyFamily: "donchian-breakout" });
  assert.equal(request.strategyFamily, "donchian-breakout");
  assert.deepEqual(request.candidateGrid.map((entry) => entry.key), [
    "donchian-10", "donchian-20", "donchian-30", "donchian-40", "donchian-55"
  ]);
  assert.deepEqual(request.referenceParameters, [
    { source: "PRODUCTION_DEFAULT", candidateKey: "donchian-20", parameters: { channelPeriod: 20 } },
    { source: "MANUAL_RESEARCH_REFERENCE", candidateKey: "donchian-55", parameters: { channelPeriod: 55 } }
  ]);
  assert.deepEqual(request.candidateGrid.find((entry) => entry.key === "donchian-20").neighbors, ["donchian-10", "donchian-30"]);
  assert.deepEqual(request.candidateGrid.find((entry) => entry.key === "donchian-55").neighbors, ["donchian-40"]);
  assert.ok(request.candidateGrid.every(Object.isFrozen));
});


test("canonical volatility compression robustness request uses frozen 3x3 adjacency", () => {
  const request = buildParameterRobustnessRequest({ candles, manifest, strategyFamily: "volatility-compression-breakout" });
  assert.equal(request.strategyFamily, "volatility-compression-breakout");
  assert.equal(request.candidateGrid.length, 9);
  assert.deepEqual(request.referenceParameters, [
    { source: "PRODUCTION_DEFAULT", candidateKey: "vcb-20-0.70", parameters: { breakoutLookback: 20, compressionRatio: 0.7 } },
    { source: "MANUAL_RESEARCH_REFERENCE", candidateKey: "vcb-10-0.50", parameters: { breakoutLookback: 10, compressionRatio: 0.5 } }
  ]);
  const center = request.candidateGrid.find((entry) => entry.key === "vcb-20-0.70");
  assert.deepEqual(center.neighbors, ["vcb-10-0.70", "vcb-20-0.50", "vcb-20-0.90", "vcb-30-0.70"]);
  assert.ok(request.candidateGrid.every(Object.isFrozen));
  assert.ok(request.candidateGrid.every((entry) => Object.isFrozen(entry.neighbors)));
});
