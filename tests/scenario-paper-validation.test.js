const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateScenarioPaperEvidence } = require("../dist/apps/cloud/src/scenarioPaperValidation.js");

const complete = (overrides = {}) => ({
  generatedAt: 1_000,
  observedSessions: 20,
  completedOrders: 50,
  marketRegimes: 3,
  restartRecoveryPasses: 3,
  duplicateOrderChecks: 10,
  passedFaultScenarios: ["PERSISTENCE_FAILURE", "WEBSOCKET_DISCONNECT", "PARTIAL_WRITE", "DUPLICATE_SIGNAL", "KILL_SWITCH"],
  walkForwardPassed: true,
  costStressPassed: true,
  monteCarloPassed: true,
  integrityChecksPassed: true,
  ...overrides
});

test("passes complete scenario evidence without requiring calendar duration", () => {
  const result = evaluateScenarioPaperEvidence(complete());
  assert.equal(result.status, "PASS");
  assert.equal(result.profile, "SCENARIO_BASED");
  assert.deepEqual(result.reasons, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.minimums));
});

test("fails closed for every missing evidence family", () => {
  const result = evaluateScenarioPaperEvidence(complete({
    observedSessions: 19,
    completedOrders: 49,
    marketRegimes: 2,
    restartRecoveryPasses: 2,
    duplicateOrderChecks: 9,
    passedFaultScenarios: [],
    walkForwardPassed: false,
    costStressPassed: false,
    monteCarloPassed: false,
    integrityChecksPassed: false
  }));
  assert.equal(result.status, "FAIL");
  for (const reason of [
    "INSUFFICIENT_OBSERVED_SESSIONS",
    "INSUFFICIENT_COMPLETED_ORDERS",
    "INSUFFICIENT_MARKET_REGIMES",
    "INSUFFICIENT_RESTART_RECOVERY_PASSES",
    "INSUFFICIENT_DUPLICATE_ORDER_CHECKS",
    "WALK_FORWARD_NOT_PASSED",
    "COST_STRESS_NOT_PASSED",
    "MONTE_CARLO_NOT_PASSED",
    "INTEGRITY_CHECK_NOT_PASSED"
  ]) assert.ok(result.reasons.includes(reason));
  assert.equal(result.reasons.filter((reason) => reason.startsWith("FAULT_SCENARIO_")).length, 5);
});

test("rejects duplicate, unsupported and malformed evidence", () => {
  assert.throws(() => evaluateScenarioPaperEvidence(complete({ passedFaultScenarios: ["KILL_SWITCH", "KILL_SWITCH"] })), /unique/);
  assert.throws(() => evaluateScenarioPaperEvidence(complete({ passedFaultScenarios: ["UNKNOWN"] })), /unsupported/);
  assert.throws(() => evaluateScenarioPaperEvidence(complete({ completedOrders: 1.5 })), /safe integer/);
});

test("scenario validation replay is deterministic", () => {
  assert.deepEqual(evaluateScenarioPaperEvidence(complete()), evaluateScenarioPaperEvidence(complete()));
});
