const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../scripts/restricted-live-activation-rehearsal');
const base = require('../config/live/restricted-live-activation-rehearsal.json');

const clone = () => JSON.parse(JSON.stringify(base));

test('valid rehearsal returns WOULD_ALLOW while execution stays suppressed', () => {
  const result = evaluate(clone());
  assert.equal(result.result, 'WOULD_ALLOW');
  assert.equal(result.executionSuppressed, true);
  assert.equal(result.actualActivation, false);
});

test('connected transport or credentials fail closed', () => {
  const a = clone(); a.executionTransportConnected = true;
  const b = clone(); b.credentialStoragePresent = true;
  assert.equal(evaluate(a).result, 'BLOCKED');
  assert.equal(evaluate(b).result, 'BLOCKED');
});

test('real money or automatic activation permission fails closed', () => {
  const a = clone(); a.realMoneyExecutionAllowed = true;
  const b = clone(); b.automaticActivationAllowed = true;
  assert.equal(evaluate(a).result, 'BLOCKED');
  assert.equal(evaluate(b).result, 'BLOCKED');
});

test('one explicit human OWNER approval is mandatory', () => {
  const missing = clone(); delete missing.ownerApproval;
  const ai = clone(); ai.ownerApproval.kind = 'AI';
  const wrongRole = clone(); wrongRole.ownerApproval.role = 'OPERATOR';
  const implicit = clone(); implicit.ownerApproval.explicit = false;
  assert.equal(evaluate(missing).result, 'BLOCKED');
  assert.equal(evaluate(ai).result, 'BLOCKED');
  assert.equal(evaluate(wrongRole).result, 'BLOCKED');
  assert.equal(evaluate(implicit).result, 'BLOCKED');
});

test('a second approver is not required', () => {
  const p = clone();
  assert.equal('approvers' in p, false);
  assert.equal(evaluate(p).result, 'WOULD_ALLOW');
});

test('unsafe operational state or UNKNOWN fails closed', () => {
  const a = clone(); a.safety.operationalState = 'RESTRICTED';
  const b = clone(); b.safety.safetyCriticalUnknown = true;
  assert.equal(evaluate(a).result, 'BLOCKED');
  assert.equal(evaluate(b).result, 'BLOCKED');
});

test('kill switch, hard risk failure, deployment failure or open P0 blocks', () => {
  for (const mutate of [
    p => { p.safety.killSwitchActive = true; },
    p => { p.safety.hardRiskResult = 'FAIL'; },
    p => { p.safety.deploymentIntegrityResult = 'FAIL'; },
    p => { p.safety.openP0 = true; }
  ]) {
    const p = clone(); mutate(p); assert.equal(evaluate(p).result, 'BLOCKED');
  }
});

test('scope rollback audit and single-use requirements fail closed', () => {
  const a = clone(); a.scope.rollbackBundleId = '';
  const b = clone(); b.authorization.auditReceiptId = '';
  const c = clone(); c.authorization.singleUse = false;
  assert.equal(evaluate(a).result, 'BLOCKED');
  assert.equal(evaluate(b).result, 'BLOCKED');
  assert.equal(evaluate(c).result, 'BLOCKED');
});

test('any actual mutation counter blocks rehearsal', () => {
  for (const key of ['brokerCalls','orders','fills','cash','positions']) {
    const p = clone(); p.mutationCounters[key] = 1;
    assert.equal(evaluate(p).result, 'BLOCKED');
  }
});
