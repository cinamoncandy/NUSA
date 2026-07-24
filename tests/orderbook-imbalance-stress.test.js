const test = require("node:test");
const assert = require("node:assert/strict");
const { runOrderbookImbalanceStress } = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceStress.js");

const scenario = (scenarioId, kind, overrides = {}) => ({
  scenarioId,
  kind,
  severity: kind === "BASELINE" ? 0 : 0.5,
  feeMultiplier: 1,
  slippageMultiplier: 1,
  spreadMultiplier: 1,
  latencySnapshots: 0,
  liquidityMultiplier: 1,
  missingSnapshotRatio: 0,
  volatilityMultiplier: 1,
  capacityMultiplier: 1,
  ...overrides
});

const observation = (scenarioId, overrides = {}) => ({
  scenarioId,
  totalReturn: 0.08,
  sharpe: 1.2,
  maxDrawdown: 0.12,
  tradeCount: 10,
  fillRatio: 0.9,
  ...overrides
});

const scenarios = () => [
  scenario("BASE", "BASELINE"),
  scenario("FEE-2", "FEE", { feeMultiplier: 2 }),
  scenario("FEE-3", "FEE", { feeMultiplier: 3 }),
  scenario("SLIP-2", "SLIPPAGE", { slippageMultiplier: 2 }),
  scenario("LIQ-50", "LIQUIDITY", { liquidityMultiplier: 0.5 })
];

const observations = () => [
  observation("BASE", { totalReturn: 0.1, sharpe: 1.5 }),
  observation("FEE-2", { totalReturn: 0.04, sharpe: 0.8 }),
  observation("FEE-3", { totalReturn: -0.01, sharpe: -0.2 }),
  observation("SLIP-2", { totalReturn: 0, sharpe: 0.1 }),
  observation("LIQ-50", { totalReturn: 0.03, sharpe: 0.5, fillRatio: 0.6 })
];

const policy = {
  engineVersion: 1,
  minimumPositiveScenarioRatio: 0.5,
  minimumMedianSharpe: 0,
  maximumWorstDrawdown: 0.5,
  minimumMedianFillRatio: 0.5,
  maximumFragilityScore: 0.9
};

test("aggregates stress scenarios deterministically", () => {
  const first = runOrderbookImbalanceStress(scenarios(), observations(), "2026-01-01T00:00:00.000Z", policy);
  const second = runOrderbookImbalanceStress(scenarios(), observations(), "2026-01-01T00:00:00.000Z", policy);
  assert.deepEqual(first, second);
  assert.equal(first.scenarioCount, 5);
  assert.equal(first.breakEvenFeeMultiplier, 3);
  assert.equal(first.breakEvenSlippageMultiplier, 2);
  assert.match(first.resultHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.scenarios));
});

test("fails policy when scenarios are fragile", () => {
  const result = runOrderbookImbalanceStress(
    scenarios(),
    observations().map((item) => item.scenarioId === "BASE" ? item : { ...item, totalReturn: -0.2, sharpe: -2, maxDrawdown: 0.8, fillRatio: 0.1 }),
    "2026-01-01T00:00:00.000Z",
    { ...policy, maximumWorstDrawdown: 0.3, maximumFragilityScore: 0.5 }
  );
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("POSITIVE_SCENARIO_RATIO_LOW"));
  assert.ok(result.reasons.includes("WORST_DRAWDOWN_HIGH"));
});

test("rejects duplicate scenarios, missing baseline, and mismatched observations", () => {
  const duplicate = scenarios();
  duplicate.push({ ...duplicate[0] });
  assert.throws(() => runOrderbookImbalanceStress(duplicate, [...observations(), observations()[0]], "2026-01-01T00:00:00.000Z", policy), /duplicate scenario/);

  assert.throws(() => runOrderbookImbalanceStress(scenarios().filter((item) => item.kind !== "BASELINE"), observations().filter((item) => item.scenarioId !== "BASE"), "2026-01-01T00:00:00.000Z", policy), /BASELINE/);
  assert.throws(() => runOrderbookImbalanceStress(scenarios(), observations().slice(0, -1), "2026-01-01T00:00:00.000Z", policy), /every scenario/);
});
