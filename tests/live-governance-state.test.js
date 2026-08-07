const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedLiveGovernanceTransitions, assertLiveGovernanceTransition, canEnterActive, failClosedState, validateHumanAuthorization } = require('../dist/apps/execution/src/live-governance-state.js');

const now = '2026-08-07T14:00:00.000Z';
const auth = Object.freeze({ authorizationId: 'auth-test-1', approvedBy: ['human-a','human-b'], scope: { market: 'KRW-BTC', maxNotional: 1 }, issuedAt: '2026-08-07T13:59:00.000Z', expiresAt: '2026-08-07T14:05:00.000Z', singleUse: true, consumed: false });
const prohibited = Object.freeze({ realMoneyExecutionAllowed: false, executionTransportConnected: false, executionCredentialUseAllowed: false, operationalState: 'SAFE', hardRiskPass: true, killSwitchInactive: true });

test('default governance graph keeps ACTIVE gated and HALT reachable', () => {
  const graph = allowedLiveGovernanceTransitions();
  for (const state of ['ARMED','AUTHORIZED','ACTIVE','COOLDOWN']) assert.ok(graph[state].includes('HALT'));
  assert.deepEqual(graph.DISABLED, ['ARMED']);
});

test('current policy rejects ACTIVE even with valid human authorization', () => {
  assert.equal(validateHumanAuthorization(auth, now), true);
  assert.equal(canEnterActive(prohibited, auth, now), false);
  assert.throws(() => assertLiveGovernanceTransition('AUTHORIZED','ACTIVE',prohibited,auth,now), /LIVE_ACTIVE_PROHIBITED_FAIL_CLOSED/);
});

test('expired consumed duplicate or secret-bearing authorization fails closed', () => {
  assert.equal(validateHumanAuthorization({ ...auth, expiresAt: '2026-08-07T13:59:30.000Z' }, now), false);
  assert.equal(validateHumanAuthorization({ ...auth, consumed: true }, now), false);
  assert.equal(validateHumanAuthorization({ ...auth, approvedBy: ['human-a','human-a'] }, now), false);
  assert.equal(validateHumanAuthorization({ ...auth, scope: { credential: 'x' } }, now), false);
});

test('invalid transition and unknown state fail closed', () => {
  assert.throws(() => assertLiveGovernanceTransition('DISABLED','ACTIVE',prohibited,auth,now), /LIVE_STATE_TRANSITION_REJECTED/);
  assert.equal(failClosedState('BOGUS'), 'HALT');
  assert.equal(failClosedState(null), 'HALT');
});

test('governance module exposes no broker mutation methods', () => {
  const mod = require('../dist/apps/execution/src/live-governance-state.js');
  for (const key of ['submitOrder','cancelOrder','withdraw','amendOrder','resolveCredential']) assert.equal(typeof mod[key], 'undefined');
});
