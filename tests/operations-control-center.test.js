const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  OPERATIONS_CONTROL_DESCRIPTOR,
  OperationsAuditLog,
  OperationsAlertCenter,
  IncidentTimeline,
  OperationsControlCenter,
  buildOperationsProjection,
  evidenceReferenceDigest,
} = require('../dist/apps/execution/src/operations-control-center.js');

const now = '2026-08-08T00:00:00.000Z';
const healthy = () => ({
  governanceState: 'DISABLED', operationalState: 'SAFE', hardRisk: 'PASS', killSwitchActive: false,
  reconciliation: 'MATCH', marketData: 'HEALTHY', recoveryReady: true,
  health: [{ component: 'runtime', state: 'HEALTHY', reasonCode: null, observedAt: now }],
  evidence: [{ id: 'risk-1', kind: 'hard-risk', digest: 'sha256:1234567890abcdef', observedAt: now }],
  metadata: { status: 'ok' },
});

test('operations projection is read-only and preserves healthy evidence', () => {
  const projection = buildOperationsProjection(healthy(), now);
  assert.equal(projection.mode, 'READ_ONLY_OPERATIONS');
  assert.equal(projection.overallHealth, 'HEALTHY');
  assert.equal(projection.executionAuthority, false);
  assert.equal(projection.realMoneyExecutionAllowed, false);
  assert.equal(OPERATIONS_CONTROL_DESCRIPTOR.killSwitchReleaseAuthority, false);
});

test('safety critical UNKNOWN remains UNKNOWN and never synthesizes healthy', () => {
  for (const patch of [
    { operationalState: 'UNKNOWN' }, { hardRisk: 'UNKNOWN' }, { reconciliation: 'UNKNOWN' }, { marketData: 'UNKNOWN' },
    { health: [{ component: 'runtime', state: 'UNKNOWN', reasonCode: 'NO_EVIDENCE', observedAt: now }] },
  ]) assert.equal(buildOperationsProjection({ ...healthy(), ...patch }, now).overallHealth, 'UNKNOWN');
});

test('critical blockers remain visible', () => {
  assert.equal(buildOperationsProjection({ ...healthy(), killSwitchActive: true }, now).overallHealth, 'CRITICAL');
  assert.equal(buildOperationsProjection({ ...healthy(), reconciliation: 'DIFF' }, now).overallHealth, 'CRITICAL');
  assert.equal(buildOperationsProjection({ ...healthy(), marketData: 'DISCONNECTED' }, now).overallHealth, 'CRITICAL');
});

test('operator payload recursively redacts secret-like material', () => {
  const projection = buildOperationsProjection({ ...healthy(), metadata: { accessKey: 'abc', nested: { authorization: 'Bearer abc', normal: 'visible' } } }, now);
  assert.equal(projection.metadata.accessKey, '[REDACTED]');
  assert.equal(projection.metadata.nested.authorization, '[REDACTED]');
  assert.equal(projection.metadata.nested.normal, 'visible');
  const digest = evidenceReferenceDigest({ apiSecret: 'hidden', status: 'PASS' });
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
});

test('alerts incidents and audit are append-only observation records', () => {
  const audit = new OperationsAuditLog();
  const alerts = new OperationsAlertCenter(audit);
  const alert = alerts.raise('CRITICAL', 'KILL_SWITCH_ACTIVE', 'blocked', now);
  alerts.acknowledge(alert.alertId, 'human-a', 'HUMAN', '2026-08-08T00:01:00.000Z');
  const incidents = new IncidentTimeline();
  incidents.append('KILL_SWITCH', 'latched', 'risk-1', '2026-08-08T00:02:00.000Z');
  assert.equal(alerts.list().length, 1);
  assert.equal(incidents.list().length, 1);
  assert.equal(audit.list()[0].action, 'ALERT_ACKNOWLEDGED');
});

test('control center only emits safe-reduction or review requests and never executes mutation', () => {
  const audit = new OperationsAuditLog(); const center = new OperationsControlCenter(audit);
  const halt = center.requestSafeControl('REQUEST_HALT', 'system-risk', 'SYSTEM', 'RISK_UNKNOWN', now);
  const review = center.requestSafeControl('REQUEST_RECOVERY_REVIEW', 'human-a', 'HUMAN', 'RECOVERY_CHECK', now);
  assert.equal(halt.executesMutation, false); assert.equal(halt.authorizesLive, false);
  assert.equal(review.executesMutation, false); assert.equal(review.authorizesLive, false);
  assert.throws(() => center.requestSafeControl('AUTHORIZE_ACTIVE', 'human-a', 'HUMAN', 'NO', now), /RISK_INCREASE_ACTION_PROHIBITED/);
});

test('source validator rejects execution authority surface', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'apps/execution/src/operations-control-center.ts'), 'utf8');
  for (const forbidden of ['submitOrder(', 'cancelOrder(', 'amendOrder(', 'withdraw(', 'releaseKillSwitch(', 'resolveExecutionCredential(', 'authorizeActive(']) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(source, /executionAuthority: false/);
  assert.match(source, /realMoneyExecutionAllowed: false/);
});
