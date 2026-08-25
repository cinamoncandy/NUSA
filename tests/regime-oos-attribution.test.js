const test = require("node:test");
const assert = require("node:assert/strict");
const { attributeWalkForwardOosByRegime, marketRegimeKey } = require("../dist/apps/desktop/src/strategy/regimeOosAttribution.js");

const regime = (timestamp, trend, volatility = "NORMAL_VOLATILITY", liquidity = "NORMAL_LIQUIDITY") => ({
  timestamp,
  trend,
  volatility,
  liquidity,
  confidence: 1,
  evidence: {},
  classifierVersion: "test-v1"
});

const trade = (entryTime, exitTime, netPnL) => ({
  entryTime,
  exitTime,
  entryPrice: 100,
  exitPrice: 100 + netPnL,
  quantity: 1,
  fees: 0,
  grossPnL: netPnL,
  netPnL,
  holdingDuration: exitTime - entryTime
});

const timeline = (entries) => ({
  classifierId: "classifier",
  classifierConfig: {},
  points: entries.map((item) => ({ point: { timestamp: item.timestamp, close: 100 }, regime: item })),
  regimeCounts: {},
  transitionCounts: {},
  warnings: []
});

const walkForward = (trades) => ({
  windows: [{
    window: { index: 0, trainStart: 0, trainEnd: 0, testStart: 1, testEnd: 2, trainPoints: [], testPoints: [] },
    selectedCandidateId: "candidate",
    trainResult: {},
    testResult: { trades },
    candidateTrainScores: [],
    selectionReason: "test"
  }],
  combinedOutOfSampleMetrics: {},
  candidateSelectionCounts: {},
  stabilityDiagnostics: { candidates: [], selectionChurn: 0, selectionChurnRatio: 0 },
  warnings: []
});

test("attributes OOS trades by entry regime and preserves exit regime", () => {
  const result = attributeWalkForwardOosByRegime(
    walkForward([trade(1, 2, 10), trade(3, 4, -5)]),
    timeline([
      regime(1, "UP_TREND"), regime(2, "RANGE"),
      regime(3, "DOWN_TREND"), regime(4, "RANGE")
    ])
  );
  assert.equal(result.basis, "ENTRY");
  assert.equal(result.attributedTrades[0].entryRegime.trend, "UP_TREND");
  assert.equal(result.attributedTrades[0].exitRegime.trend, "RANGE");
  assert.deepEqual(result.buckets.map((bucket) => bucket.regimeKey), [
    "DOWN_TREND|NORMAL_VOLATILITY|NORMAL_LIQUIDITY",
    "UP_TREND|NORMAL_VOLATILITY|NORMAL_LIQUIDITY"
  ]);
  assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.performance.netProfit, 0), 5);
});

test("supports explicit exit-regime attribution without mixing bases", () => {
  const result = attributeWalkForwardOosByRegime(
    walkForward([trade(1, 2, 10), trade(3, 4, -5)]),
    timeline([
      regime(1, "UP_TREND"), regime(2, "RANGE"),
      regime(3, "DOWN_TREND"), regime(4, "RANGE")
    ]),
    "EXIT"
  );
  assert.equal(result.basis, "EXIT");
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].regimeKey, "RANGE|NORMAL_VOLATILITY|NORMAL_LIQUIDITY");
  assert.equal(result.buckets[0].performance.trades, 2);
});

test("is deterministic and sorts bucket keys lexically", () => {
  const input = walkForward([trade(3, 4, -5), trade(1, 2, 10)]);
  const regimes = timeline([
    regime(1, "UP_TREND"), regime(2, "RANGE"),
    regime(3, "DOWN_TREND"), regime(4, "RANGE")
  ]);
  assert.deepEqual(attributeWalkForwardOosByRegime(input, regimes), attributeWalkForwardOosByRegime(input, regimes));
});

test("reports missing timeline coverage instead of inventing a regime", () => {
  const result = attributeWalkForwardOosByRegime(
    walkForward([trade(1, 2, 10), trade(3, 4, -5)]),
    timeline([regime(1, "UP_TREND"), regime(2, "RANGE")])
  );
  assert.equal(result.unattributedTradeCount, 1);
  assert.ok(result.warnings.includes("UNATTRIBUTED_TRADES"));
  assert.equal(result.attributedTrades.length, 1);
});

test("reports empty and sparse samples honestly", () => {
  const empty = attributeWalkForwardOosByRegime(walkForward([]), timeline([regime(1, "RANGE")]));
  assert.ok(empty.warnings.includes("NO_ATTRIBUTED_OOS_TRADES"));
  const sparse = attributeWalkForwardOosByRegime(walkForward([trade(1, 2, 1)]), timeline([regime(1, "RANGE"), regime(2, "RANGE")]));
  assert.ok(sparse.warnings.includes("SPARSE_REGIME_SAMPLE"));
  assert.ok(sparse.warnings.includes("SINGLE_REGIME_DOMINATES"));
});

test("rejects invalid basis and duplicate timeline timestamps", () => {
  assert.throws(() => attributeWalkForwardOosByRegime(walkForward([]), timeline([]), "OTHER"), /ENTRY or EXIT/);
  const duplicate = {
    classifierId: "x",
    classifierConfig: {},
    points: [
      { point: { timestamp: 1, close: 100 }, regime: regime(1, "RANGE") },
      { point: { timestamp: 1, close: 101 }, regime: regime(1, "UP_TREND") }
    ],
    regimeCounts: {}, transitionCounts: {}, warnings: []
  };
  assert.throws(() => attributeWalkForwardOosByRegime(walkForward([]), duplicate), /duplicate timestamps/);
});

test("market regime key keeps all three dimensions explicit", () => {
  assert.equal(marketRegimeKey(regime(1, "UP_TREND", "HIGH_VOLATILITY", "LOW_LIQUIDITY")), "UP_TREND|HIGH_VOLATILITY|LOW_LIQUIDITY");
});
