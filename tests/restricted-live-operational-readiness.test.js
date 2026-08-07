const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { validateReadiness, buildEvidence } = require('../scripts/restricted-live-readiness-harness');

const baseline = JSON.parse(fs.readFileSync('config/live/restricted-live-readiness.json', 'utf8'));
const mutate = (fn) => { const copy = JSON.parse(JSON.stringify(baseline)); fn(copy); return copy; };

test('baseline restricted live readiness passes without mutation', () => {
  const result = validateReadiness(baseline);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test('connected execution transport fails closed', () => {
  const result = validateReadiness(mutate(p => { p.executionTransportConnected = true; }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('EXECUTION_TRANSPORT_CONNECTED'));
});

test('credential storage presence fails closed', () => {
  const result = validateReadiness(mutate(p => { p.credentialStoragePresent = true; }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('CREDENTIAL_STORAGE_PRESENT'));
});

test('automatic or real money execution permission fails closed', () => {
  const result = validateReadiness(mutate(p => { p.automaticActivationAllowed = true; p.realMoneyExecutionAllowed = true; }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('AUTOMATIC_ACTIVATION_ALLOWED'));
  assert.ok(result.failures.includes('REAL_MONEY_EXECUTION_ALLOWED'));
});

test('two distinct human approvers remain mandatory', () => {
  const result = validateReadiness(mutate(p => { p.requiredHumanApprovers = 1; p.requireDistinctApprovers = false; }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('TWO_DISTINCT_HUMANS_NOT_REQUIRED'));
});

test('non-SAFE or UNKNOWN-tolerant readiness fails closed', () => {
  const result = validateReadiness(mutate(p => { p.requiredOperationalState = 'DEGRADED'; p.safetyCriticalUnknownAllowed = true; }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('SAFE_NOT_REQUIRED'));
  assert.ok(result.failures.includes('UNKNOWN_NOT_FAIL_CLOSED'));
});

test('missing rollback/scope/time governance fails closed', () => {
  const result = validateReadiness(mutate(p => { p.requireRollbackTarget = false; p.requireExpiry = false; p.requireCooldown = false; p.requireExactScope = false; }));
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('ROLLBACK_NOT_REQUIRED'));
  assert.ok(result.failures.includes('EXPIRY_NOT_REQUIRED'));
  assert.ok(result.failures.includes('COOLDOWN_NOT_REQUIRED'));
  assert.ok(result.failures.includes('EXACT_SCOPE_NOT_REQUIRED'));
});

test('any actual mutation counter invalidates readiness evidence', () => {
  const profile = mutate(p => { p.mutationCounters.orders = 1; });
  const evidence = buildEvidence(profile, 'test-revision');
  assert.equal(evidence.result, 'FAIL');
  assert.ok(evidence.checks.includes('MUTATION_COUNTER_NONZERO:orders'));
});
