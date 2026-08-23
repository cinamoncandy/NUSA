const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePaperLearningReadOnlySnapshot } = require('../dist/packages/contracts/src/paperLearningReadOnly.js');

const baseEvent = Object.freeze({
  id: 'event-1', cycleId: 'paper:KRW-BTC:1000', mode: 'PAPER', stage: 'MARKET_DATA', occurredAt: 1100,
  market: 'KRW-BTC', status: 'PASS', reason: 'fresh data'
});

const snapshot = (events = [baseEvent]) => ({
  schemaVersion: 1, mode: 'PAPER', readOnly: true, liveAuthority: 'NONE', productionMutationAllowed: false,
  runtimeStatus: 'RUNNING', generatedAt: 1200, events
});

test('PAPER learning transport accepts bounded deterministic read-only replay', () => {
  const validated = validatePaperLearningReadOnlySnapshot(snapshot());
  assert.equal(validated.events.length, 1);
  assert.equal(validated.mode, 'PAPER');
  assert.equal(validated.readOnly, true);
  assert.equal(validated.liveAuthority, 'NONE');
  assert.equal(validated.productionMutationAllowed, false);
  assert.ok(Object.isFrozen(validated));
});

test('PAPER learning transport rejects duplicate ids and non-PAPER authority', () => {
  assert.throws(() => validatePaperLearningReadOnlySnapshot(snapshot([baseEvent, baseEvent])), /duplicate event id/);
  assert.throws(() => validatePaperLearningReadOnlySnapshot({ ...snapshot(), liveAuthority: 'ENABLED' }), /authority invariant/);
});

test('PAPER learning transport rejects secret/account/order/fill identifier fields', () => {
  assert.throws(() => validatePaperLearningReadOnlySnapshot(snapshot([{ ...baseEvent, accountId: 'acct-1' }])), /prohibited/);
  assert.throws(() => validatePaperLearningReadOnlySnapshot(snapshot([{ ...baseEvent, orderId: 'order-1' }])), /prohibited/);
  assert.throws(() => validatePaperLearningReadOnlySnapshot(snapshot([{ ...baseEvent, token: 'secret' }])), /prohibited/);
});

test('PAPER learning transport requires deterministic newest-first order', () => {
  assert.throws(() => validatePaperLearningReadOnlySnapshot(snapshot([
    { ...baseEvent, id: 'older', occurredAt: 1000 },
    { ...baseEvent, id: 'newer', occurredAt: 1100 }
  ])), /deterministic newest-first/);
});
