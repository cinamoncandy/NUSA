const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySafetyInvariants, loadRepositoryInputs } = require('../scripts/validate-safety-invariants');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseline() {
  const inputs = loadRepositoryInputs();
  return {
    safety: clone(inputs.safety),
    shadow: clone(inputs.shadow),
    restricted: clone(inputs.restricted),
    shadowRuntimeSource: inputs.shadowRuntimeSource,
    aiZeroAuthorityPass: inputs.aiZeroAuthorityPass,
  };
}

test('repository safety contracts are coherent across layers', () => {
  const result = verifySafetyInvariants(baseline());
  assert.equal(result.pass, true, result.failures.join('\n'));
});

test('learned risk can never relax deterministic hard risk', () => {
  const inputs = baseline();
  inputs.safety.authorities.learnedRisk.mayRelaxHardLimits = true;
  const result = verifySafetyInvariants(inputs);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('INVARIANT_HARD_RISK_NON_OVERRIDABLE'));
});

test('shadow evidence can never grant LIVE or production authority', () => {
  const inputs = baseline();
  inputs.shadow.promotion.shadow_evidence_sufficient_for_live_authorization = true;
  const result = verifySafetyInvariants(inputs);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('INVARIANT_HUMAN_LIVE_AUTHORITY'));
});

test('safety-critical UNKNOWN must fail closed before risk increase', () => {
  const inputs = baseline();
  inputs.restricted.requirements.safety_critical_unknown_must_be_false = false;
  const result = verifySafetyInvariants(inputs);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('INVARIANT_SAFETY_CRITICAL_UNKNOWN_FAIL_CLOSED'));
});

test('HALT recovery cannot bypass human authorization', () => {
  const inputs = baseline();
  inputs.restricted.break_glass.may_override_halt = true;
  const result = verifySafetyInvariants(inputs);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('INVARIANT_HALT_RECOVERY_HUMAN_CONTROLLED'));
});

test('execution and production mutation boundaries remain closed', () => {
  const inputs = baseline();
  inputs.shadow.execution_transport_connected = true;
  const result = verifySafetyInvariants(inputs);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('INVARIANT_MUTATION_BOUNDARY'));
});

test('AI zero-authority guard failure fails the composed invariant suite', () => {
  const inputs = baseline();
  inputs.aiZeroAuthorityPass = false;
  const result = verifySafetyInvariants(inputs);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('AI_ZERO_AUTHORITY:FAILED'));
});
