const test = require("node:test");
const assert = require("node:assert/strict");
const { decideCio } = require("../dist/apps/cloud/src/cioDecisionEngine.js");

const base = (overrides = {}) => ({
  symbol: "btcusdt",
  now: 1_000,
  currentAllocation: 0,
  maxAllocation: 0.2,
  maxLeverage: 3,
  risk: "LOW",
  tradingEnabled: true,
  signals: [
    { source: "ETF", score: 0.8, confidence: 0.9, observedAt: 990, reason: "net inflow" },
    { source: "CHART", score: 0.6, confidence: 0.8, observedAt: 995, reason: "trend confirmed" },
    { source: "RISK", score: 0.4, confidence: 0.9, observedAt: 998, reason: "volatility contained" }
  ],
  ...overrides
});

test("creates a deterministic buy decision", () => {
  const input = base();
  const first = decideCio(input);
  const second = decideCio({ ...input, signals: [...input.signals].reverse() });
  assert.deepEqual(first, second);
  assert.equal(first.symbol, "BTCUSDT");
  assert.equal(first.action, "BUY");
  assert.equal(first.leverage, 2);
  assert.ok(first.allocation > 0 && first.allocation <= 0.2);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.reasons), true);
});

test("waits when trading is disabled", () => {
  const result = decideCio(base({ tradingEnabled: false }));
  assert.equal(result.action, "WAIT");
  assert.equal(result.allocation, 0);
  assert.equal(result.leverage, 1);
});

test("fails closed under critical risk", () => {
  const result = decideCio(base({ risk: "CRITICAL", currentAllocation: 0.15 }));
  assert.equal(result.action, "EXIT");
  assert.equal(result.allocation, 0);
  assert.equal(result.leverage, 1);
});

test("reduces exposure under high risk", () => {
  const result = decideCio(base({ risk: "HIGH", currentAllocation: 0.2 }));
  assert.equal(result.action, "REDUCE");
  assert.equal(result.allocation, 0.1);
});

test("sells on sufficiently negative evidence", () => {
  const result = decideCio(base({
    currentAllocation: 0.1,
    signals: [
      { source: "NEWS", score: -0.9, confidence: 0.9, observedAt: 990, reason: "systemic shock" },
      { source: "CHART", score: -0.8, confidence: 0.8, observedAt: 995, reason: "support broken" },
      { source: "RISK", score: -0.7, confidence: 0.9, observedAt: 998, reason: "risk rising" }
    ]
  }));
  assert.equal(result.action, "SELL");
  assert.equal(result.allocation, 0);
});

test("rejects malformed or conflicting inputs", () => {
  assert.throws(() => decideCio(base({ signals: [] })), /at least one signal/);
  assert.throws(() => decideCio(base({ currentAllocation: 0.3 })), /exceeds maxAllocation/);
  assert.throws(() => decideCio(base({ signals: [
    { source: "ETF", score: 0.2, confidence: 0.8, observedAt: 900, reason: "one" },
    { source: "ETF", score: 0.3, confidence: 0.8, observedAt: 901, reason: "two" }
  ] })), /duplicate signal source/);
  assert.throws(() => decideCio(base({ signals: [
    { source: "ETF", score: 2, confidence: 0.8, observedAt: 900, reason: "invalid" }
  ] })), /between -1 and 1/);
  assert.throws(() => decideCio(base({ signals: [
    { source: "ETF", score: 0.2, confidence: 0.8, observedAt: 1_001, reason: "future" }
  ] })), /observedAt is invalid/);
});
