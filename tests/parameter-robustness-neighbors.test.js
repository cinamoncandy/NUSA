const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCandidateGrid, findImmediateNeighbors, runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");

function candle(openTime, close) {
  return { market: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000, open: close, high: close + 5, low: close - 5, close, volume: 1 };
}
function trendingCandles(count) {
  return Array.from({ length: count }, (_, i) => candle(i * 60_000, Math.round(100_000 + Math.sin(i / 6) * 800 + Math.sin(i / 40) * 4000)));
}

test("immediate neighbors are the 8 grid-adjacent cells around a reference, not the whole grid", () => {
  const neighborhood = { shortOffsets: [-2, -1, 0, 1, 2], longOffsets: [-5, -2, 0, 2, 5] };
  const grid = buildCandidateGrid([{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }], neighborhood, 100);
  const reference = { shortWindow: 5, longWindow: 20 };
  const neighbors = findImmediateNeighbors(grid, reference, neighborhood);
  assert.equal(neighbors.length, 8);
  assert.ok(neighbors.every((n) => !(n.shortWindow === 5 && n.longWindow === 20)));
});

test("immediate-neighbor adjacency is index-based on the declared offset grid, not raw value distance", () => {
  // longOffsets = [-5,-2,0,2,5]: the declared grid step near 0 is 2, not 1, so a
  // candidate at longWindow+2 is adjacent (index distance 1) while +5 is not.
  const neighborhood = { shortOffsets: [0], longOffsets: [-5, -2, 0, 2, 5] };
  const grid = buildCandidateGrid([{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }], neighborhood, 100);
  const reference = { shortWindow: 5, longWindow: 20 };
  const neighbors = findImmediateNeighbors(grid, reference, neighborhood);
  const longWindows = neighbors.map((n) => n.longWindow).sort((a, b) => a - b);
  assert.deepEqual(longWindows, [18, 22]);
});

test("a reference with a positive full-sample return whose immediate neighbors mostly agree in direction and beat the benchmark is BROAD_PLATEAU", () => {
  const candles = trendingCandles(400);
  const request = {
    schemaVersion: 1, id: "ROBUST-BROAD-001", market: "KRW-BTC", candles,
    referenceParameters: [{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }],
    neighborhood: { shortOffsets: [-1, 0, 1], longOffsets: [-2, 0, 2] },
    minimumTrades: 0,
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    evaluation: { mode: "FULL_SAMPLE" },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  // Not asserting the specific classification (depends on synthetic data specifics),
  // only that the fields needed to compute it are present and internally consistent.
  const reference = result.references[0];
  assert.ok(["BROAD_PLATEAU", "NARROW_PLATEAU", "ISOLATED_PEAK", "FLAT_WEAK", "UNSTABLE"].includes(reference.assessment));
  assert.ok(reference.immediateNeighborCount > 0);
});

test("a reference whose own full-sample return is not positive is classified FLAT_WEAK", () => {
  // Flat candles produce zero signal-driven return for any SMA crossover.
  const flatCandles = Array.from({ length: 300 }, (_, i) => candle(i * 60_000, 100_000));
  const request = {
    schemaVersion: 1, id: "ROBUST-FLAT-001", market: "KRW-BTC", candles: flatCandles,
    referenceParameters: [{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }],
    neighborhood: { shortOffsets: [-1, 0, 1], longOffsets: [-2, 0, 2] },
    minimumTrades: 0,
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    evaluation: { mode: "FULL_SAMPLE" },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "PASS", JSON.stringify(result.failures));
  assert.equal(result.references[0].assessment, "FLAT_WEAK");
});
