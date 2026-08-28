const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateStrategyRollback } = require("../dist/apps/cloud/src/strategyRollbackEngine.js");

const base = {
  now: 1,
  strategyId: "x",
  version: "2",
  maximumDrawdown: 0.01,
  maximumDrawdownThreshold: 0.1,
  rollingSharpe: 1,
  minimumRollingSharpe: 0,
  executionQualityScore: 90,
  minimumExecutionQualityScore: 80,
  unresolvedFaultCount: 0,
  partialHedgeRecoveryFailures: 0,
  killSwitchActive: false,
  featureFingerprintMatches: true,
  dataQualityHealthy: true,
  paperAvailabilityRatio: 1,
  minimumAvailabilityRatio: 0.99,
  strategyDriftDetected: false,
  unresolvedExposure: false,
};
const errorField = {
  maximumDrawdown: "MAXIMUM_DRAWDOWN",
  maximumDrawdownThreshold: "MAXIMUM_DRAWDOWN_THRESHOLD",
  rollingSharpe: "ROLLING_SHARPE",
  minimumRollingSharpe: "MINIMUM_ROLLING_SHARPE",
  executionQualityScore: "EXECUTION_QUALITY_SCORE",
  minimumExecutionQualityScore: "MINIMUM_EXECUTION_QUALITY_SCORE",
  paperAvailabilityRatio: "PAPER_AVAILABILITY_RATIO",
  minimumAvailabilityRatio: "MINIMUM_AVAILABILITY_RATIO",
  killSwitchActive: "KILL_SWITCH_ACTIVE",
  featureFingerprintMatches: "FEATURE_FINGERPRINT_MATCHES",
  dataQualityHealthy: "DATA_QUALITY_HEALTHY",
  strategyDriftDetected: "STRATEGY_DRIFT_DETECTED",
  unresolvedExposure: "UNRESOLVED_EXPOSURE",
};

test("rejects non-finite rollback evidence before choosing an action", () => {
  for (const field of [
    "maximumDrawdown",
    "maximumDrawdownThreshold",
    "rollingSharpe",
    "minimumRollingSharpe",
    "executionQualityScore",
    "minimumExecutionQualityScore",
    "paperAvailabilityRatio",
    "minimumAvailabilityRatio",
  ]) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => evaluateStrategyRollback({ ...base, [field]: value }),
        new RegExp(`STRATEGY_ROLLBACK_INVALID_${errorField[field]}_NONFINITE`),
      );
    }
  }
});

test("rejects out-of-range ratios, scores, counts, and booleans", () => {
  for (const [field, value] of [
    ["maximumDrawdown", -0.01],
    ["maximumDrawdownThreshold", 1.01],
    ["paperAvailabilityRatio", -0.01],
    ["minimumAvailabilityRatio", 1.01],
    ["executionQualityScore", -1],
    ["minimumExecutionQualityScore", 101],
    ["unresolvedFaultCount", -1],
    ["partialHedgeRecoveryFailures", 1.5],
    ["now", 1.5],
  ]) {
    assert.throws(() => evaluateStrategyRollback({ ...base, [field]: value }), /STRATEGY_ROLLBACK_INVALID_/);
  }

  for (const field of [
    "killSwitchActive",
    "featureFingerprintMatches",
    "dataQualityHealthy",
    "strategyDriftDetected",
    "unresolvedExposure",
  ]) {
    assert.throws(() => evaluateStrategyRollback({ ...base, [field]: 1 }), new RegExp(`STRATEGY_ROLLBACK_INVALID_${errorField[field]}_BOOLEAN`));
  }

  assert.throws(() => evaluateStrategyRollback({ ...base, previousChampionVersion: " " }), /PREVIOUS_CHAMPION_VERSION/);
  assert.throws(() => evaluateStrategyRollback(null), /STRATEGY_ROLLBACK_INVALID_INPUT/);
  assert.throws(() => evaluateStrategyRollback(undefined), /STRATEGY_ROLLBACK_INVALID_INPUT/);
});

test("preserves valid rollback decisions and deterministic reason ordering", () => {
  assert.equal(evaluateStrategyRollback(base).action, "HOLD");
  assert.equal(evaluateStrategyRollback({ ...base, killSwitchActive: true }).action, "SUSPEND");
  assert.equal(evaluateStrategyRollback({ ...base, previousChampionVersion: "1", unresolvedFaultCount: 1 }).action, "ROLLBACK");
  const decision = evaluateStrategyRollback({
    ...base,
    dataQualityHealthy: false,
    strategyDriftDetected: true,
    maximumDrawdown: 0.2,
    maximumDrawdownThreshold: 0.1,
    paperAvailabilityRatio: 0.5,
    minimumAvailabilityRatio: 0.9,
  });
  assert.equal(decision.action, "SUSPEND");
  assert.deepEqual(decision.reasons, ["AVAILABILITY", "DATA_QUALITY", "DRAWDOWN", "STRATEGY_DRIFT"]);
});
