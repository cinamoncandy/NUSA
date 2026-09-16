const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCandidateGrid, runParameterRobustnessRequest } = require("../scripts/lib/parameter-robustness-runner.js");

test("the grid includes exactly the reference plus every offset combination, deduplicated", () => {
  const grid = buildCandidateGrid(
    [{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }],
    { shortOffsets: [-1, 0, 1], longOffsets: [-2, 0, 2] },
    100
  );
  assert.equal(grid.length, 9);
  assert.ok(grid.some((c) => c.shortWindow === 5 && c.longWindow === 20 && c.isReference));
  assert.ok(grid.some((c) => c.shortWindow === 4 && c.longWindow === 18));
  assert.ok(grid.some((c) => c.shortWindow === 6 && c.longWindow === 22));
});

test("overlapping tuples produced by two references are canonicalized to a single entry", () => {
  const grid = buildCandidateGrid(
    [
      { source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 },
      { source: "WALK_FORWARD_SELECTED", shortWindow: 5, longWindow: 20 }
    ],
    { shortOffsets: [0], longOffsets: [0] },
    100
  );
  assert.equal(grid.length, 1);
  assert.equal(grid[0].distanceFromReferences.length, 2);
});

test("shortWindow <= 0 is marked invalid, not silently dropped", () => {
  const grid = buildCandidateGrid(
    [{ source: "PRODUCTION_DEFAULT", shortWindow: 2, longWindow: 20 }],
    { shortOffsets: [-3], longOffsets: [0] },
    100
  );
  const candidate = grid.find((c) => c.shortWindow === -1);
  assert.ok(candidate);
  assert.equal(candidate.valid, false);
});

test("shortWindow 1 is marked invalid to match the production SMA constructor", () => {
  const grid = buildCandidateGrid(
    [{ source: "MANUAL_RESEARCH_REFERENCE", shortWindow: 2, longWindow: 8 }],
    { shortOffsets: [-1, 0], longOffsets: [0] },
    100
  );
  assert.equal(grid.find((candidate) => candidate.shortWindow === 1)?.valid, false);
  assert.equal(grid.find((candidate) => candidate.shortWindow === 2)?.valid, true);
});

test("longWindow >= the training bound is marked invalid", () => {
  const grid = buildCandidateGrid(
    [{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }],
    { shortOffsets: [0], longOffsets: [90] },
    100
  );
  const candidate = grid.find((c) => c.longWindow === 110);
  assert.ok(candidate);
  assert.equal(candidate.valid, false);
});

test("distanceFromReferences is the absolute-difference (Manhattan) metric, not a fabricated geometric one", () => {
  const grid = buildCandidateGrid(
    [{ source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }],
    { shortOffsets: [-2], longOffsets: [5] },
    100
  );
  const candidate = grid.find((c) => c.shortWindow === 3 && c.longWindow === 25);
  assert.equal(candidate.distanceFromReferences[0].short, 2);
  assert.equal(candidate.distanceFromReferences[0].long, 5);
  assert.equal(candidate.distanceFromReferences[0].normalized, 7);
});

test("a request whose neighborhood produces no valid candidate at all fails cleanly", () => {
  const request = {
    schemaVersion: 1, id: "ROBUST-ALL-INVALID", market: "KRW-BTC",
    candles: Array.from({ length: 50 }, (_, i) => ({ market: "KRW-BTC", interval: "1m", openTime: i * 60_000, closeTime: i * 60_000 + 60_000, open: 100, high: 105, low: 95, close: 100, volume: 1 })),
    referenceParameters: [{ source: "PRODUCTION_DEFAULT", shortWindow: 2, longWindow: 40 }],
    neighborhood: { shortOffsets: [0], longOffsets: [0] },
    minimumTrades: 0,
    execution: { initialCash: 10_000_000, executionCosts: { spreadBps: 0 }, latencyCandles: 0, riskPolicy: {} },
    evaluation: { mode: "FULL_SAMPLE" },
    costConditions: [
      { name: "BASE", feeRate: 0.0005, slippageBps: 5 },
      { name: "MODERATE", feeRate: 0.001, slippageBps: 10 },
      { name: "SEVERE", feeRate: 0.002, slippageBps: 30 }
    ]
  };
  // longWindow 40 >= trainingBound (candles.length=50 in FULL_SAMPLE mode is fine, but
  // let's force invalidity via a longWindow that exceeds the dataset itself instead).
  request.referenceParameters[0].longWindow = 60;
  const result = runParameterRobustnessRequest(request);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((m) => m.includes("no valid candidate")));
});
