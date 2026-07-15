const test = require("node:test");
const assert = require("node:assert/strict");
const { buildScenarioPaperEvidenceBundle, scenarioObservationsFromLedger, verifyScenarioPaperEvidenceBundle } = require("../dist/apps/cloud/src/scenarioEvidenceBundle.js");
const { appendPaperScenarioEvent } = require("../dist/apps/cloud/src/paperScenarioEvidenceLedger.js");

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
  monteCarloEvidenceId: "mc-001",
  integrityEvidenceId: "integrity-001",
  walkForwardPassed: true,
  costStressPassed: true,
  monteCarloPassed: true,
  integrityChecksPassed: true,
  ...overrides
});

const append = (records, eventId, type, occurredAt, sessionId, scenario) => appendPaperScenarioEvent(records, { eventId, type, occurredAt, sessionId, scenario });

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
  const bundle = buildScenarioPaperEvidenceBundle(observations(), research({ monteCarloPassed: false }), 2_000);
  assert.equal(bundle.validation.status, "FAIL");
  assert.ok(bundle.validation.reasons.includes("MONTE_CARLO_NOT_PASSED"));
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

test("verifier detects record, counter, validation and checksum tampering", () => {
  const bundle = buildScenarioPaperEvidenceBundle(observations(), research(), 2_000);
  assert.equal(verifyScenarioPaperEvidenceBundle(bundle).contentSha256, bundle.contentSha256);

  const changedRecords = bundle.observations.map((record, index) => index === 0 ? { ...record, completedOrders: record.completedOrders + 1 } : record);
  assert.throws(() => verifyScenarioPaperEvidenceBundle({ ...bundle, observations: changedRecords }), /checksum mismatch/);
  assert.throws(() => verifyScenarioPaperEvidenceBundle({
    ...bundle,
    derivedInput: { ...bundle.derivedInput, completedOrders: bundle.derivedInput.completedOrders + 1 }
  }), /derived counters mismatch/);
  assert.throws(() => verifyScenarioPaperEvidenceBundle({
    ...bundle,
    validation: { ...bundle.validation, status: "FAIL" }
  }), /validation mismatch/);
  assert.throws(() => verifyScenarioPaperEvidenceBundle({ ...bundle, contentSha256: "bad" }), /SHA-256/);
});

test("ledger conversion rejects sessions without explicit SESSION_OBSERVED evidence", () => {
  let records = [];
  records = append(records, "order-1", "ORDER_COMPLETED", 1_000, "session-1");
  assert.throws(() => scenarioObservationsFromLedger(records), /missing SESSION_OBSERVED/);
});

test("unclassified sessions count as sessions but never as represented market regimes", () => {
  let records = [];
  records = append(records, "session-1", "SESSION_OBSERVED", 1_000, "session-1");
  records = append(records, "order-1", "ORDER_COMPLETED", 1_001, "session-1");
  const converted = scenarioObservationsFromLedger(records);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].marketRegime, undefined);
  const bundle = buildScenarioPaperEvidenceBundle(converted, research(), 2_000);
  assert.equal(bundle.derivedInput.observedSessions, 1);
  assert.equal(bundle.derivedInput.completedOrders, 1);
  assert.equal(bundle.derivedInput.marketRegimes, 0);
  assert.ok(bundle.validation.reasons.includes("INSUFFICIENT_MARKET_REGIMES"));
});
