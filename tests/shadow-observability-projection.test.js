const test = require("node:test");
const assert = require("node:assert/strict");
const { buildShadowReadOnlyProjection } = require("../dist/apps/desktop/src/shadow/shadowReadOnlyProjection.js");
const { validateShadowObservabilitySnapshot } = require("../dist/packages/contracts/src/shadowObservabilityReadOnly.js");

const diagnostics = (overrides = {}) => ({
  state: "RUNNING", sessionId: "session-1", symbol: "KRW-BTC", strategyId: "sma-crossover", marketDataStatus: "HEALTHY", marketFreshness: "FRESH",
  closedCandleCount: 4, requiredWarmupCandles: 3, warmupComplete: true, lastClosedCandleTime: 4_000, lastSignalTime: 4_000,
  startedAt: 1_000, elapsedMs: 3_000, maxSessionDurationMs: null, outOfOrderCandleCount: 1, duplicateCandleCount: 2, staleCandleCount: 3,
  signalCount: 1, hypotheticalOrderCount: 1, hypotheticalFillCount: 1, actualBrokerCallCount: 0, executionGateCallCount: 0,
  actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0, blockers: [], lastSignal: null,
  automaticResumeAllowed: false, marketRecoveryResumeAllowed: false, marketRecoveryResumeSuggested: false, marketConnection: null,
  productionMutationAllowed: false, strategyVersion: "v1", inputType: "CLOSED_CANDLE", interval: "1m", sourceType: "UPBIT_PUBLIC_CANDLE",
  strategyFingerprint: "fp", completionHistory: [], longRunning: {}, ...overrides
});

const event = (sequence, eventType, overrides = {}) => ({
  sequence, timestamp: sequence * 1_000, sessionId: "session-1", eventType, signalId: `signal-${sequence}`, commandId: `command-${sequence}`,
  riskDecision: "ALLOW", reasonCodes: [], actualBrokerCallCount: 0, actualOrderDelta: 0, actualFillDelta: 0, actualCashDelta: 0,
  actualPositionDelta: 0, previousEventSha256: sequence === 1 ? "GENESIS" : `hash-${sequence - 1}`, eventSha256: `hash-${sequence}`, ...overrides
});

test("SHADOW projection is read-only, deterministic, and preserves admission truth", () => {
  const events = [event(1, "SESSION_STARTED"), event(2, "SIGNAL_OBSERVED"), event(3, "BLOCKED", { riskDecision: "REJECT", reasonCodes: ["DUPLICATE_SIGNAL"] })];
  const first = buildShadowReadOnlyProjection({ diagnostics: diagnostics(), events, generatedAt: 9_000 });
  const second = buildShadowReadOnlyProjection({ diagnostics: diagnostics(), events: [...events].reverse(), generatedAt: 9_000 });
  assert.deepEqual(first, second);
  assert.equal(first.mode, "SHADOW");
  assert.equal(first.readOnly, true);
  assert.equal(first.liveAuthority, "NONE");
  assert.equal(first.productionMutationAllowed, false);
  assert.equal(first.aiAuthority, "ZERO_AUTHORITY");
  assert.deepEqual(first.admission, { duplicateCandleCount: 2, staleCandleCount: 3, outOfOrderCandleCount: 1, lastClosedCandleTime: 4_000, closedCandleCount: 4 });
  assert.equal(first.events[1].stage, "SIGNAL");
  assert.equal(first.events[2].stage, undefined);
  assert.equal(first.events[2].status, "FAIL");
});

test("duplicate evidence is suppressed and conflicting sequences fail closed", () => {
  const duplicate = event(1, "SESSION_STARTED");
  const projection = buildShadowReadOnlyProjection({ diagnostics: diagnostics(), events: [duplicate, duplicate], generatedAt: 9_000 });
  assert.equal(projection.events.length, 1);
  assert.throws(() => buildShadowReadOnlyProjection({ diagnostics: diagnostics(), events: [duplicate, { ...duplicate, eventSha256: "other" }], generatedAt: 9_000 }), /conflicting SHADOW observability event sequence/);
});

test("sensitive reason data cannot cross the contract boundary", () => {
  const base = buildShadowReadOnlyProjection({ diagnostics: diagnostics(), events: [event(1, "SESSION_STARTED")], generatedAt: 9_000 });
  assert.throws(() => validateShadowObservabilitySnapshot({ ...base, events: [{ ...base.events[0], reasonCodes: ["token=secret"] }] }), /reason codes are invalid/);
  assert.throws(() => validateShadowObservabilitySnapshot({ ...base, accountId: "acct-private" }), /prohibited/);
});

test("admission, halt, recovery, and mutation counters remain observable without authority", () => {
  const projected = buildShadowReadOnlyProjection({ diagnostics: diagnostics({ state: "HALTED", blockers: ["CANDLE_SEQUENCE_REGRESSION"], marketDataStatus: "OUT_OF_ORDER", marketFreshness: "STALE", actualOrderCount: 0 }), events: [event(1, "SESSION_STARTED"), event(2, "MARKET_CONNECTION", { marketConnection: { disconnectedAt: 2_000, reconnectAttemptCount: 1, recoveredAt: null, totalDowntime: 5_000, finalReconnectState: "FAILED" } }), event(3, "SESSION_STOPPED")], generatedAt: 9_000 });
  assert.equal(projected.runtimeStatus, "HALTED");
  assert.equal(projected.marketFreshness, "STALE");
  assert.deepEqual(projected.blockers, ["CANDLE_SEQUENCE_REGRESSION"]);
  assert.equal(projected.counters.actualBrokerCallCount, 0);
  assert.equal(projected.events[1].stage, "MARKET_DATA");
});
