const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDefaultFundingPersistenceStressScenarios,
  runFundingPersistenceStress
} = require("../dist/apps/cloud/src/alpha/funding/FundingPersistenceStress.js");

const candle = (index, open, close, fundingRate = 0) => Object.freeze({
  candleId: `C-${index}`,
  market: "BTCUSDT",
  openTime: new Date(Date.UTC(2026, 0, 1, index, 0, 0)).toISOString(),
  closeTime: new Date(Date.UTC(2026, 0, 1, index + 1, 0, 0)).toISOString(),
  open,
  high: Math.max(open, close) * 1.02,
  low: Math.min(open, close) * 0.98,
  close,
  fundingRate
});

const decision = (id, hour, action, targetPosition, eligible = true) => Object.freeze({
  decisionId: id,
  strategyId: "FUNDING_PERSISTENCE_MEAN_REVERSION",
  strategyVersion: 1,
  market: "BTCUSDT",
  generatedAt: new Date(Date.UTC(2026, 0, 1, hour, 30, 0)).toISOString(),
  action,
  targetPosition,
  signalStrength: eligible ? 0.8 : 0,
  eligible,
  reasons: Object.freeze([eligible ? "TEST" : "ABSTAIN"]),
  featureVersion: 1,
  featureGeneratedAt: new Date(Date.UTC(2026, 0, 1, hour, 20, 0)).toISOString(),
  featureProvenance: Object.freeze([`S-${hour}`])
});

const backtestPolicy = Object.freeze({
  engineVersion: 1,
  initialCapital: 100000,
  allocationFraction: 0.5,
  takerFeeRate: 0.0005,
  slippageRate: 0.0005,
  borrowRatePerCandle: 0.00005,
  periodsPerYear: 365 * 24,
  closeOpenPositionAtEnd: true
});

const stressPolicy = Object.freeze({
  engineVersion: 1,
  minimumRobustnessScore: 0.3,
  maximumAcceptableDrawdown: 0.5,
  minimumPositiveScenarioRatio: 0.2,
  maximumScenarioCount: 32
});

const candles = [
  candle(0, 100, 100, -0.0002),
  candle(1, 100, 104, -0.0002),
  candle(2, 104, 108, -0.0002),
  candle(3, 108, 110, -0.0001),
  candle(4, 110, 107, 0),
  candle(5, 107, 105, 0),
  candle(6, 105, 106, 0)
];

const decisions = [
  decision("D-1", 0, "ENTER_LONG", "LONG"),
  decision("D-2", 3, "EXIT", "FLAT")
];

test("creates a deterministic immutable default stress grid", () => {
  const first = createDefaultFundingPersistenceStressScenarios();
  const second = createDefaultFundingPersistenceStressScenarios();
  assert.deepEqual(first, second);
  assert.ok(first.length >= 10);
  assert.equal(first.filter((item) => item.kind === "BASELINE").length, 1);
  assert.ok(Object.isFrozen(first));
  assert.ok(first.every(Object.isFrozen));
});

test("runs the full stress grid deterministically", () => {
  const scenarios = createDefaultFundingPersistenceStressScenarios();
  const first = runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    scenarios,
    "2026-01-02T00:00:00.000Z",
    stressPolicy
  );
  const second = runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    scenarios,
    "2026-01-02T00:00:00.000Z",
    stressPolicy
  );
  assert.deepEqual(first, second);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(first.observations.length, scenarios.length);
  assert.ok(first.robustnessScore >= 0 && first.robustnessScore <= 1);
  assert.equal(first.fragilityScore, Math.round((1 - first.robustnessScore) * 1e9) / 1e9);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.observations));
  assert.ok(first.observations.every(Object.isFrozen));
});

test("applies cost, latency, gap, volatility, missing-candle, and capacity scenarios", () => {
  const scenarios = createDefaultFundingPersistenceStressScenarios();
  const result = runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    scenarios,
    "2026-01-02T00:00:00.000Z",
    stressPolicy
  );
  const kinds = new Set(result.observations.map((item) => item.kind));
  for (const kind of ["BASELINE", "COST", "LATENCY", "MISSING_CANDLE", "GAP", "VOLATILITY", "CAPACITY"]) {
    assert.ok(kinds.has(kind), `missing stress kind ${kind}`);
  }
  const baseline = result.observations.find((item) => item.scenarioId === "BASE");
  const costly = result.observations.find((item) => item.scenarioId === "FEE_3X");
  assert.ok(baseline);
  assert.ok(costly);
  assert.ok(costly.finalEquity <= baseline.finalEquity);
});

test("reports policy pass and fail reasons without automatic promotion", () => {
  const scenarios = createDefaultFundingPersistenceStressScenarios();
  const strict = runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    scenarios,
    "2026-01-02T00:00:00.000Z",
    { ...stressPolicy, minimumRobustnessScore: 1, minimumPositiveScenarioRatio: 1, maximumAcceptableDrawdown: 0 }
  );
  assert.equal(strict.passed, false);
  assert.ok(strict.reasons.length >= 1);
  assert.ok(strict.reasons.some((reason) => [
    "ROBUSTNESS_SCORE_LOW",
    "POSITIVE_SCENARIO_RATIO_LOW",
    "ONE_OR_MORE_DRAWDOWN_BREACHES",
    "BASELINE_NOT_POSITIVE"
  ].includes(reason)));
});

test("rejects duplicate scenarios and missing baseline", () => {
  const scenarios = createDefaultFundingPersistenceStressScenarios();
  assert.throws(() => runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    [scenarios[0], scenarios[0]],
    "2026-01-02T00:00:00.000Z",
    stressPolicy
  ), /duplicate scenario/);

  assert.throws(() => runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    scenarios.filter((item) => item.kind !== "BASELINE"),
    "2026-01-02T00:00:00.000Z",
    stressPolicy
  ), /exactly one BASELINE/);
});

test("rejects invalid scenario fields and excessive grids", () => {
  const scenarios = createDefaultFundingPersistenceStressScenarios();
  assert.throws(() => runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    [
      scenarios[0],
      Object.freeze({ ...scenarios[1], scenarioId: "BAD", feeMultiplier: -1 })
    ],
    "2026-01-02T00:00:00.000Z",
    stressPolicy
  ), /non-negative/);

  assert.throws(() => runFundingPersistenceStress(
    candles,
    decisions,
    backtestPolicy,
    scenarios,
    "2026-01-02T00:00:00.000Z",
    { ...stressPolicy, maximumScenarioCount: 2 }
  ), /exceeds maximumScenarioCount/);
});
