const test = require('node:test');
const assert = require('node:assert/strict');
const { projectReadOnlyOperatorState } = require('../dist/apps/desktop/src/readOnlyOperatorProjection.js');

test('projection is read-only and secret-free', () => {
  const value = projectReadOnlyOperatorState({ observedAt: '2026-08-07T00:00:00.000Z', connectionCode: 'CONNECTED', configured: true, assetCount: 2, openOrderCount: 1, krwBalance: '1000.25', reconciliationStatus: 'MATCH' });
  assert.equal(value.mode, 'READ_ONLY');
  assert.equal(value.authority.execution, false);
  assert.equal(value.authority.orderMutation, false);
  assert.equal(value.authority.withdrawals, false);
  assert.equal(value.authority.credentialMaterial, false);
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /access.?key|secret.?key|authorization|bearer|token/i);
  assert.equal(typeof value.submitOrder, 'undefined');
  assert.equal(typeof value.cancelOrder, 'undefined');
  assert.equal(typeof value.withdraw, 'undefined');
});

test('unknown and invalid source data fail closed', () => {
  const value = projectReadOnlyOperatorState({ observedAt: '2026-08-07T00:00:00.000Z', connectionCode: 'NETWORK_ERROR', configured: true, assetCount: -1, openOrderCount: Number.NaN, krwBalance: 'not-a-number', reconciliationStatus: 'UNKNOWN' });
  assert.equal(value.connection.available, false);
  assert.equal(value.account.assetCount, null);
  assert.equal(value.account.openOrderCount, null);
  assert.equal(value.account.krwBalance, null);
  assert.equal(value.reconciliation.healthy, null);
});

test('reconciliation DIFF is explicitly unhealthy', () => {
  const value = projectReadOnlyOperatorState({ observedAt: '2026-08-07T00:00:00.000Z', connectionCode: 'CONNECTED', configured: true, assetCount: 1, openOrderCount: 0, krwBalance: '1', reconciliationStatus: 'DIFF' });
  assert.equal(value.reconciliation.healthy, false);
});
