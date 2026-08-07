const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { validate } = require('../scripts/restricted-live-transport-credential-readiness.js');

const base = JSON.parse(fs.readFileSync('config/live/restricted-live-transport-credential-readiness.json', 'utf8'));
const copy = () => JSON.parse(JSON.stringify(base));

test('baseline passes with disabled read-only adapter and no secrets or mutations', () => {
  assert.equal(validate(copy()).pass, true);
});

test('connected or dialable transport fails closed', () => {
  const a = copy(); a.executionTransportConnected = true;
  assert.equal(validate(a).pass, false);
  const b = copy(); b.transportDialAllowed = true;
  assert.equal(validate(b).pass, false);
});

test('adapter must remain disabled and read-only', () => {
  const a = copy(); a.adapter.defaultState = 'ENABLED';
  assert.equal(validate(a).pass, false);
  const b = copy(); b.adapter.capability = 'EXECUTION';
  assert.equal(validate(b).pass, false);
});

test('execution/order/cancel methods must not be exposed', () => {
  for (const key of ['executionMethodsExposed','orderSubmissionExposed','cancelOrderExposed']) {
    const p = copy(); p.adapter[key] = true;
    assert.equal(validate(p).pass, false);
  }
});

test('secret material or credential storage/resolution fails closed', () => {
  for (const key of ['secretMaterialPresent','storageEnabled','resolutionEnabled','executionUseAllowed']) {
    const p = copy(); p.credentials[key] = true;
    assert.equal(validate(p).pass, false);
  }
});

test('credential boundary must be metadata-only with registered schema', () => {
  const a = copy(); a.credentials.schemaRegistered = false;
  assert.equal(validate(a).pass, false);
  const b = copy(); b.credentials.referenceMode = 'SECRET_VALUE';
  assert.equal(validate(b).pass, false);
});

test('unsafe or UNKNOWN-tolerant safety configuration fails closed', () => {
  const a = copy(); a.safety.operationalStateRequired = 'DEGRADED';
  assert.equal(validate(a).pass, false);
  const b = copy(); b.safety.safetyCriticalUnknownAllowed = true;
  assert.equal(validate(b).pass, false);
});

test('any transport credential broker or portfolio mutation counter invalidates readiness', () => {
  for (const key of ['transportDials','credentialResolutions','brokerCalls','orders','fills','cash','positions']) {
    const p = copy(); p.mutationCounters[key] = 1;
    assert.equal(validate(p).pass, false);
  }
});
