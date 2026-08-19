const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DeterministicRateLimitManager,
  RateLimitDecisionType,
  assessClockSynchronization,
  assertClockSafeForSignedRequest,
  ClockSynchronizationStatus,
  applySequencedEvent,
  beginSnapshotRecovery,
  commitRecoverySnapshot,
  WebSocketRecoveryStatus
} = require('../dist/apps/execution/src/index.js');

test('rate limit manager allows, delays, blocks oversized requests, and deduplicates request ids', () => {
  const manager = new DeterministicRateLimitManager({ capacity: 10, refillTokens: 2, refillIntervalMs: 1000, maximumQueueDelayMs: 2000 }, 0);
  assert.equal(manager.evaluate({ requestId: 'a', weight: 8, nowMs: 0 }).type, RateLimitDecisionType.ALLOW);
  const delayed = manager.evaluate({ requestId: 'b', weight: 4, nowMs: 0 });
  assert.equal(delayed.type, RateLimitDecisionType.DELAY);
  assert.equal(delayed.retryAtMs, 1000);
  assert.deepEqual(manager.evaluate({ requestId: 'b', weight: 4, nowMs: 999 }), delayed);
  assert.equal(manager.evaluate({ requestId: 'too-heavy', weight: 11, nowMs: 0 }).type, RateLimitDecisionType.BLOCK);
});

test('rate limit manager rejects backwards time', () => {
  const manager = new DeterministicRateLimitManager({ capacity: 10, refillTokens: 1, refillIntervalMs: 1000, maximumQueueDelayMs: 0 }, 1000);
  assert.throws(() => manager.evaluate({ requestId: 'past', weight: 1, nowMs: 999 }), /clock moved backwards/);
});

test('clock synchronization classifies safe, degraded, unsafe and stale evidence', () => {
  const policy = { degradedOffsetMs: 100, unsafeOffsetMs: 500, maximumSampleAgeMs: 1000, recvWindowMs: 1000 };
  const safe = assessClockSynchronization({ sampleId: 'safe', localSendMs: 1000, providerTimeMs: 1050, localReceiveMs: 1100 }, policy);
  assert.equal(safe.status, ClockSynchronizationStatus.SYNCHRONIZED);
  assert.doesNotThrow(() => assertClockSafeForSignedRequest(safe, 1500));
  assert.throws(() => assertClockSafeForSignedRequest(safe, 2101), /stale/);

  const degraded = assessClockSynchronization({ sampleId: 'degraded', localSendMs: 1000, providerTimeMs: 1300, localReceiveMs: 1100 }, policy);
  assert.equal(degraded.status, ClockSynchronizationStatus.DEGRADED);
  const unsafe = assessClockSynchronization({ sampleId: 'unsafe', localSendMs: 1000, providerTimeMs: 1700, localReceiveMs: 1100 }, policy);
  assert.equal(unsafe.status, ClockSynchronizationStatus.UNSAFE);
  assert.throws(() => assertClockSafeForSignedRequest(unsafe, 1100), /unsafe/);
});

test('websocket stream detects a gap and requires a non-regressing snapshot', () => {
  let state = { status: WebSocketRecoveryStatus.SYNCHRONIZED };
  let decision = applySequencedEvent(state, { eventId: 'e1', firstSequence: 10n, finalSequence: 10n });
  assert.equal(decision.applyEvent, true);
  state = decision.state;

  decision = applySequencedEvent(state, { eventId: 'e3', firstSequence: 12n, finalSequence: 12n, previousFinalSequence: 11n });
  assert.equal(decision.state.status, WebSocketRecoveryStatus.GAP_DETECTED);
  assert.equal(decision.requestSnapshot, true);

  state = beginSnapshotRecovery(decision.state);
  assert.throws(() => commitRecoverySnapshot(state, 9n), /regresses/);
  state = commitRecoverySnapshot(state, 12n);
  assert.equal(state.status, WebSocketRecoveryStatus.SYNCHRONIZED);
  assert.equal(state.lastAppliedSequence, 12n);

  const next = applySequencedEvent(state, { eventId: 'e4', firstSequence: 13n, finalSequence: 13n, previousFinalSequence: 12n });
  assert.equal(next.applyEvent, true);
});
