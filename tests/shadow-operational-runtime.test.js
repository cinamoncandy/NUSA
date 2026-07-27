const test = require("node:test");
const assert = require("node:assert/strict");
const { SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategyEngine.js");
const { ShadowOperationalRuntime, InMemoryShadowEventSink } = require("../dist/apps/desktop/src/shadowOperationalRuntime.js");

const candle = (openTime, close = 100, qualityStatus = "VALID") => ({
  symbol: "KRW-BTC", interval: "1m", openTime, closeTime: openTime + 60_000,
  open: close, high: close, low: close, close, volume: 1,
  sourceType: "UPBIT_PUBLIC_CANDLE", sourceEventCount: 1,
  firstSourceTimestamp: openTime, lastSourceTimestamp: openTime,
  closeConfirmed: qualityStatus === "VALID", duplicateCount: 0, outOfOrderCount: 0,
  gapDetected: false, reconnectBoundary: false, incomplete: qualityStatus !== "VALID",
  qualityStatus, candleId: `KRW-BTC:1m:${openTime}`
});

const makeRuntime = (riskStatus = "REJECT") => {
  const sink = new InMemoryShadowEventSink();
  let executions = 0;
  const runtime = new ShadowOperationalRuntime({
    symbol: "KRW-BTC", strategy: new SmaCrossoverStrategy(5, 20),
    strategyVersion: "sma-crossover:closed-candle-1m-v1",
    strategyFingerprint: "a".repeat(64), sourceCommitSha: "a".repeat(40),
    requiredWarmupCandles: 20, hypotheticalQuantity: 0.0001,
    riskEvaluator: { evaluate: () => ({ status: riskStatus, reasonCodes: [riskStatus] }) },
    execution: { execute: () => { executions += 1; return { hypotheticalOrderId: "o", hypotheticalFillId: "f" }; } },
    eventSink: sink, clock: () => 1_700_000_000_000, sessionIdFactory: () => "session-1"
  });
  runtime.onMarketStatus("connected");
  return { runtime, sink, executions: () => executions };
};

test("warm-up is independent from owner start and requires all valid closed candles", () => {
  const { runtime } = makeRuntime();
  for (let i = 0; i < 19; i += 1) runtime.acceptCandle(candle(i * 60_000));
  assert.equal(runtime.snapshot().shadowState, "IDLE");
  runtime.acceptCandle(candle(19 * 60_000));
  assert.equal(runtime.snapshot().shadowState, "READY");
  assert.equal(runtime.snapshot().sessionId, null);
  runtime.startOwner();
  assert.equal(runtime.snapshot().shadowState, "RUNNING");
});

test("invalid candles, risk rejects, and risk halts cannot execute hypothetically", () => {
  const rejected = makeRuntime("REJECT");
  for (let i = 0; i < 20; i += 1) rejected.runtime.acceptCandle(candle(i * 60_000));
  rejected.runtime.startOwner();
  rejected.runtime.acceptCandle(candle(20 * 60_000, 101));
  assert.equal(rejected.executions(), 0);
  assert.equal(rejected.runtime.snapshot().actualBrokerCallCount, 0);
  assert.equal(rejected.runtime.snapshot().cashMutationCount, 0);
  const invalid = makeRuntime("ALLOW");
  invalid.runtime.acceptCandle(candle(0, 100, "INCOMPLETE"));
  assert.equal(invalid.runtime.snapshot().validClosedCandleCount, 0);
});

test("reconnect invalidates warm-up and requires explicit resume after re-warm-up", () => {
  const { runtime } = makeRuntime("REJECT");
  for (let i = 0; i < 20; i += 1) runtime.acceptCandle(candle(i * 60_000));
  const session = runtime.startOwner().sessionId;
  runtime.disconnect("MARKET_RECONNECTING");
  assert.equal(runtime.snapshot().sessionId, session);
  assert.equal(runtime.snapshot().shadowState, "INVALIDATED");
  assert.equal(runtime.snapshot().validClosedCandleCount, 0);
  assert.throws(() => runtime.resumeOwner(session));
  for (let i = 0; i < 20; i += 1) runtime.acceptCandle(candle(i * 60_000));
  assert.equal(runtime.snapshot().shadowState, "READY");
  assert.throws(() => runtime.resumeOwner(session));
});

test("events are ordered, sequenced, and immutable", () => {
  const { runtime } = makeRuntime();
  runtime.acceptCandle(candle(0));
  const events = runtime.events();
  assert.deepEqual(events.map((event) => event.runtimeSequence), [0, 1]);
  assert.equal(Object.isFrozen(events[0]), true);
  const originalType = events[0].eventType;
  events[0].eventType = "SHADOW_STARTED";
  assert.equal(events[0].eventType, originalType);
});
