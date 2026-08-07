const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateActivationBoundary } = require('../scripts/validate-restricted-live-activation-boundary');

function baseline() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config/live/restricted-live-activation-boundary.json'), 'utf8'));
}

function evaluate(mutator) {
  const profile = baseline();
  mutator(profile);
  return validateActivationBoundary(profile);
}

test('baseline activation boundary is eligible for human review but does not activate', () => {
  const result = validateActivationBoundary(baseline());
  assert.equal(result.pass, true);
  assert.equal(result.eligibilityDecision, 'ELIGIBLE_FOR_HUMAN_REVIEW');
});

test('activation executor, connected transport, credential access, or real money permission fails closed', () => {
  for (const mutate of [
    (p) => { p.activationExecutorPresent = true; },
    (p) => { p.executionTransportConnected = true; },
    (p) => { p.credentialAccessAllowed = true; },
    (p) => { p.realMoneyExecutionAllowed = true; }
  ]) assert.equal(evaluate(mutate).eligibilityDecision, 'DENY');
});

test('machine decisions cannot include ACTIVE or EXECUTE paths', () => {
  const result = evaluate((p) => { p.allowedMachineDecisions.push('ACTIVE'); });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('MACHINE_DECISIONS_INVALID'));
});

test('exactly two distinct human approvers are mandatory', () => {
  assert.equal(evaluate((p) => { p.representativeRequest.approvers = [p.representativeRequest.approvers[0]]; }).pass, false);
  assert.equal(evaluate((p) => { p.representativeRequest.approvers[1].principalId = p.representativeRequest.approvers[0].principalId; }).pass, false);
  assert.equal(evaluate((p) => { p.representativeRequest.approvers[1].kind = 'AI'; }).pass, false);
});

test('nonce replay fails closed', () => {
  const result = evaluate((p) => { p.representativeRequest.noncePreviouslyConsumed = true; });
  assert.equal(result.eligibilityDecision, 'DENY');
  assert.ok(result.failures.includes('AUTHORIZATION_OR_NONCE_INVALID'));
});

test('non-SAFE, UNKNOWN, kill switch, open P0, or unverified rollback fails closed', () => {
  for (const mutate of [
    (p) => { p.representativeRequest.safety.operationalState = 'RESTRICTED'; },
    (p) => { p.representativeRequest.safety.safetyCriticalUnknown = true; },
    (p) => { p.representativeRequest.safety.killSwitchActive = true; },
    (p) => { p.representativeRequest.safety.openP0 = true; },
    (p) => { p.representativeRequest.safety.rollbackVerified = false; }
  ]) assert.equal(evaluate(mutate).eligibilityDecision, 'DENY');
});

test('readiness artifact digest or code revision mismatch fails closed', () => {
  assert.equal(evaluate((p) => { p.representativeRequest.readinessEvidence.artifactDigest = 'sha256:wrong'; }).pass, false);
  assert.equal(evaluate((p) => { p.representativeRequest.readinessEvidence.codeRevision = 'wrong'; }).pass, false);
});

test('AI, Meta-AI, CI, Shadow, or promotion evidence cannot acquire LIVE authority', () => {
  for (const key of ['aiLiveAuthority', 'metaAiLiveAuthority', 'ciLiveAuthority', 'shadowLiveAuthority', 'promotionEvidenceLiveAuthority']) {
    const result = evaluate((p) => { p.authority[key] = true; });
    assert.equal(result.pass, false);
    assert.ok(result.failures.includes('AUTHORITY_SEPARATION_INVALID'));
  }
});
