const test = require("node:test");
const assert = require("node:assert/strict");
const { parseShadowStart, parseShadowSession, parseShadowStatus } = require("../dist/apps/desktop/src/shadowIpcValidation.js");

test("Shadow IPC accepts only exact paper-safe payloads", () => {
  assert.deepEqual(parseShadowStart({ symbol: "KRW-BTC", strategyId: "sma-crossover", strategyVersion: "sma-crossover:closed-candle-1m-v1" }).symbol, "KRW-BTC");
  assert.equal(parseShadowSession({ sessionId: "session-1" }).sessionId, "session-1");
  assert.deepEqual(parseShadowStatus({}), {});
});

test("Shadow IPC rejects extra, malformed, and unknown payloads", () => {
  assert.throws(() => parseShadowStart({ symbol: "KRW-BTC", strategyId: "sma-crossover", strategyVersion: "v1", interval: "1m" }));
  assert.throws(() => parseShadowSession({ sessionId: "session-1", approvedBy: "owner" }));
  assert.throws(() => parseShadowStatus(null));
  assert.throws(() => parseShadowStatus({ sourceType: "UPBIT_PUBLIC_CANDLE" }));
});
