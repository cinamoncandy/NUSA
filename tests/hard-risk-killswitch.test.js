const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHardRisk, HardRiskGateway } = require('../dist/apps/execution/src/hard-risk-gateway.js');
const { LatchedKillSwitch } = require('../dist/apps/execution/src/latched-kill-switch.js');

const policy = Object.freeze({
  policyVersion: 'hard-risk-v1', maxOrderNotional: '100', maxGlobalExposure: '1000', maxStrategyExposure: '500',
  maxSymbolExposure: '300', maxDrawdown: '50', maxOpenOrders: 10, maxPositionCount: 20, maxConcentrationBps: 5000,
});
const safe = Object.freeze({
  requestedNotional: '10', globalExposure: '100', strategyExposure: '50', symbolExposure: '20', portfolioGrossExposure: '100', drawdown: '5',
  openOrders: 1, positionCount: 2, reconciliation: 'MATCH', marketData: 'HEALTHY', runtime: 'SAFE', killSwitchActive: false,
});
const now = '2026-08-07T14:30:00.000Z';

test('deterministic hard risk passes bounded safe input', () => {
  const a = evaluateHardRisk(policy, safe, now); const b = evaluateHardRisk(policy, safe, now);
  assert.equal(a.result, 'PASS'); assert.equal(a.decisionId, b.decisionId); assert.equal(a.inputDigest, b.inputDigest);
});

test('hard limits reject without mutation authority', () => {
  const value = evaluateHardRisk(policy, { ...safe, requestedNotional: '101' }, now);
  assert.equal(value.result, 'REJECT'); assert.ok(value.reasonCodes.includes('MAX_ORDER_NOTIONAL'));
  assert.throws(() => new HardRiskGateway(policy).assertPass(value), /HARD_RISK_REJECT/);
});

test('safety UNKNOWN DIFF stale disconnected and kill switch fail closed', () => {
  for (const patch of [
    { reconciliation: 'UNKNOWN' }, { reconciliation: 'DIFF' }, { marketData: 'STALE' }, { marketData: 'DISCONNECTED' }, { runtime: 'UNKNOWN' }, { killSwitchActive: true },
  ]) assert.equal(evaluateHardRisk(policy, { ...safe, ...patch }, now).result, 'BLOCK');
});

test('malformed numeric or policy input returns UNKNOWN not PASS', () => {
  assert.equal(evaluateHardRisk(policy, { ...safe, requestedNotional: 'NaN' }, now).result, 'UNKNOWN');
  assert.equal(evaluateHardRisk({ ...policy, maxConcentrationBps: 10001 }, safe, now).result, 'UNKNOWN');
});

test('latched kill switch requires two distinct humans and healthy evidence to release', () => {
  const events = []; const kill = new LatchedKillSwitch({ append: (event) => events.push(event) }, now);
  kill.trigger('HARD_RISK_UNKNOWN', '2026-08-07T14:31:00.000Z');
  assert.equal(kill.state.active, true);
  const safeEvidence = { operationalState: 'SAFE', hardRisk: 'PASS', reconciliation: 'MATCH', marketData: 'HEALTHY', unresolvedExecutionCount: 0 };
  assert.throws(() => kill.release([{ id: 'human-a', kind: 'HUMAN' }], safeEvidence, '2026-08-07T14:32:00.000Z'), /TWO_HUMAN/);
  assert.throws(() => kill.release([{ id: 'human-a', kind: 'HUMAN' }, { id: 'human-a', kind: 'HUMAN' }], safeEvidence, '2026-08-07T14:32:00.000Z'), /TWO_HUMAN/);
  assert.throws(() => kill.release([{ id: 'human-a', kind: 'HUMAN' }, { id: 'human-b', kind: 'HUMAN' }], { ...safeEvidence, reconciliation: 'UNKNOWN' }, '2026-08-07T14:32:00.000Z'), /RELEASE_UNSAFE/);
  kill.release([{ id: 'human-a', kind: 'HUMAN' }, { id: 'human-b', kind: 'HUMAN' }], safeEvidence, '2026-08-07T14:33:00.000Z');
  assert.equal(kill.state.active, false); assert.equal(events.at(-1).type, 'KILL_SWITCH_RELEASED');
});

test('kill switch module exposes no broker execution or order mutation methods', () => {
  const risk = require('../dist/apps/execution/src/hard-risk-gateway.js');
  const kill = require('../dist/apps/execution/src/latched-kill-switch.js');
  for (const key of ['submitOrder','cancelOrder','amendOrder','withdraw','resolveCredential']) {
    assert.equal(typeof risk[key], 'undefined'); assert.equal(typeof kill[key], 'undefined');
  }
});
