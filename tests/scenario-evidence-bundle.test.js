const test = require("node:test");
const assert = require("node:assert/strict");
const { buildScenarioPaperEvidenceBundle } = require("../dist/apps/cloud/src/scenarioEvidenceBundle.js");

const faults = ["PERSISTENCE_FAILURE", "WEBSOCKET_DISCONNECT", "PARTIAL_WRITE", "DUPLICATE_SIGNAL", "KILL_SWITCH"];
const observations = () => Array.from({ length: 20 }, (_, index) => ({
  recordId: `session-${String(index + 1).padStart(2, "0")}`,
  observedAt: 1_000 + index,
  completedOrders: 3,
  marketRegime: ["TREND", "RANGE", "VOLATILE"][index % 3],
  restartRecoveryPassed: index < 3,
  duplicateOrderChecks: 1,
  passedFaultScenarios: index === 0 ? faults : []
}));
const research = (overrides = {}) => ({
  walkForwardEvidenceId: "wf-001",
  costStressEvidenceId: "cost-001",
  integrityEvidenceId: "integrity-001",
  walkForwardPassed: true,
  costStressPassed: true,
  integrityChecksPassed: true,
  ...overrides
});

test("derives passing scenario counters only from immutable source records", () => {
  const bundle = buildScenarioPaperEvidenceBundle(observations(), research(), 2_000);
  assert.equal(bundle.validation.status, "PASS");
  assert.equal(bundle.derivedInput.observedSessions, 20);
  assert.equal(bundle.derivedInput.completedOrders, 60);
  assert.equal(bundle.derivedInput.marketRegimes, 3);
  assert.equal(bundle.derivedInput.restartRecoveryPasses, 3);
  assert.equal(bundle.derivedInput.duplicateOrderChecks, 20);
  assert.match(bundle.contentSha256, /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(bundle));
  assert.ok(Object.isFrozen(bundle.observations));
  assert.ok(Object.isFrozen(bundle.derivedInput));
});

test("canonical ordering makes replay identity deterministic", () => {
  const ordered = buildScenarioPaperEvidenceBundle(observations(), research(), 2_000);
  const reversed = buildScenarioPaperEvidenceBundle(observations().reverse(), research(), 2_000);
  assert.equal(ordered.contentSha256, reversed.contentSha256);
  assert.deepEqual(ordered, reversed);
});

test("one source-record mutation changes identity and derived result", () => {
  const original = buildScenarioPaperEvidenceBundle(observations(), research(), 2_000);
  const changed = observations();
  changed[0] = { ...changed[0], completedOrders: 2 };
  const mutated = buildScenarioPaperEvidenceBundle(changed, research(), 2_000);
  assert.notEqual(original.contentSha256, mutated.contentSha256);
  assert.equal(mutated.derivedInput.completedOrders, 59);
});

test("missing research evidence fails validation without fabricating a pass", () => {
  const bundle = buildScenarioPaperEvidenceBundle(observations(), research({ costStressPassed: false }), 2_000);
  assert.equal(bundle.validation.status, "FAIL");
  assert.ok(bundle.validation.reasons.includes("COST_STRESS_NOT_PASSED"));
});

test("duplicate, future and malformed source records are rejected", () => {
  const duplicate = observations();
  duplicate[1] = { ...duplicate[1], recordId: duplicate[0].recordId };
  assert.throws(() => buildScenarioPaperEvidenceBundle(duplicate, research(), 2_000), /recordIds must be unique/);

  const future = observations();
  future[0] = { ...future[0], observedAt: 2_001 };
  assert.throws(() => buildScenarioPaperEvidenceBundle(future, research(), 2_000), /future/);

  assert.throws(() => buildScenarioPaperEvidenceBundle([], research(), 2_000), /at least one/);
  assert.throws(() => buildScenarioPaperEvidenceBundle(observations(), research({ integrityEvidenceId: " " }), 2_000), /integrityEvidenceId/);
});
