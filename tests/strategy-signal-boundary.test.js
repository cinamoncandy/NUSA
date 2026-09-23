"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { StrategyEngine } = require("../dist/packages/core/src/strategyEngine.js");

function engineFor(onTick) {
  const engine = new StrategyEngine({ id: "dynamic-test", name: "Dynamic Test", onTick, reset() {} });
  engine.start();
  return engine;
}

function tick(timestamp = 1_000) {
  return { market: "KRW-BTC", price: 100, timestamp };
}

for (const [name, output, expectedReason] of [
  ["invalid signal type", { type: "EXECUTE_BUY", reason: "bad", confidence: 1, timestamp: 1_000 }, "strategy-signal-invalid:type"],
  ["NaN confidence", { type: "BUY", reason: "bad", confidence: Number.NaN, timestamp: 1_000 }, "strategy-signal-invalid:confidence"],
  ["confidence above one", { type: "BUY", reason: "bad", confidence: 1.01, timestamp: 1_000 }, "strategy-signal-invalid:confidence"],
  ["negative confidence", { type: "SELL", reason: "bad", confidence: -0.01, timestamp: 1_000 }, "strategy-signal-invalid:confidence"],
  ["empty reason", { type: "BUY", reason: "   ", confidence: 1, timestamp: 1_000 }, "strategy-signal-invalid:reason"],
  ["wrong timestamp", { type: "BUY", reason: "bad", confidence: 1, timestamp: 999 }, "strategy-signal-invalid:timestamp"],
  ["non-object signal", null, "strategy-signal-invalid:shape"],
]) {
  test(`StrategyEngine fails closed on ${name}`, () => {
    const engine = engineFor(() => output);
    const signal = engine.onTick(tick(), 0);
    assert.deepEqual(
      { type: signal.type, reason: signal.reason, confidence: signal.confidence, timestamp: signal.timestamp },
      { type: "HOLD", reason: expectedReason, confidence: 0, timestamp: 1_000 },
    );
  });
}

test("StrategyEngine preserves a valid signal at the trust boundary", () => {
  const engine = engineFor((current) => ({ type: "BUY", reason: "valid-buy", confidence: 0.6, timestamp: current.timestamp }));
  const signal = engine.onTick(tick(), 0);
  assert.deepEqual(
    { type: signal.type, reason: signal.reason, confidence: signal.confidence, timestamp: signal.timestamp },
    { type: "BUY", reason: "valid-buy", confidence: 0.6, timestamp: 1_000 },
  );
});

test("StrategyEngine never trusts strategy-supplied regime metadata", () => {
  const engine = engineFor((current) => ({
    type: "HOLD",
    reason: "valid-hold",
    confidence: 0,
    timestamp: current.timestamp,
    regime: "STRONG_UPTREND",
  }));
  const signal = engine.onTick(tick(), 0);
  assert.equal(Object.prototype.hasOwnProperty.call(signal, "regime"), false);
});
