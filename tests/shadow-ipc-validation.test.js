const test = require("node:test");
const assert = require("node:assert/strict");
const { parseShadowStartIpc, parseShadowSessionIpc, parseShadowStatusIpc, SHADOW_ALLOWED_SYMBOL, SHADOW_ALLOWED_STRATEGY_ID } = require("../dist/apps/desktop/src/shadowIpcValidation.js");

test("shadow:start accepts exactly the allowed symbol and strategyId", () => {
  const result = parseShadowStartIpc({ symbol: SHADOW_ALLOWED_SYMBOL, strategyId: SHADOW_ALLOWED_STRATEGY_ID });
  assert.deepEqual(result, { symbol: "KRW-BTC", strategyId: "sma-crossover" });
});

test("shadow:start rejects an extra field", () => {
  assert.throws(() => parseShadowStartIpc({ symbol: SHADOW_ALLOWED_SYMBOL, strategyId: SHADOW_ALLOWED_STRATEGY_ID, approval: {} }), /invalid shadow:start input/);
});

test("shadow:start rejects a missing field", () => {
  assert.throws(() => parseShadowStartIpc({ symbol: SHADOW_ALLOWED_SYMBOL }), /invalid shadow:start input/);
});

test("shadow:start rejects any symbol other than KRW-BTC", () => {
  for (const symbol of ["KRW-ETH", "krw-btc", "KRW-BTC ", "", 123, null]) {
    assert.throws(() => parseShadowStartIpc({ symbol, strategyId: SHADOW_ALLOWED_STRATEGY_ID }), `symbol ${JSON.stringify(symbol)} must be rejected`);
  }
});

test("shadow:start rejects any strategyId other than sma-crossover", () => {
  for (const strategyId of ["ema-crossover", "SMA-CROSSOVER", "", 1, undefined]) {
    assert.throws(() => parseShadowStartIpc({ symbol: SHADOW_ALLOWED_SYMBOL, strategyId }), `strategyId ${JSON.stringify(strategyId)} must be rejected`);
  }
});

test("shadow:start rejects arrays and null and non-objects", () => {
  for (const input of [null, undefined, [], ["KRW-BTC"], "KRW-BTC", 1, true]) {
    assert.throws(() => parseShadowStartIpc(input), `${JSON.stringify(input)} must be rejected`);
  }
});

test("shadow:start rejects an approval/limits/broker object smuggled in place of the payload", () => {
  assert.throws(() => parseShadowStartIpc({ symbol: SHADOW_ALLOWED_SYMBOL, strategyId: SHADOW_ALLOWED_STRATEGY_ID, limits: { maxOrderNotional: 1 } }));
  assert.throws(() => parseShadowStartIpc({ approved: true, symbol: SHADOW_ALLOWED_SYMBOL, strategyId: SHADOW_ALLOWED_STRATEGY_ID }));
});

test("shadow:pause/resume/stop accept exactly {sessionId}", () => {
  const result = parseShadowSessionIpc({ sessionId: "shadow-abc-1" });
  assert.deepEqual(result, { sessionId: "shadow-abc-1" });
});

test("shadow session payload rejects extra fields, wrong types, and empty ids", () => {
  assert.throws(() => parseShadowSessionIpc({ sessionId: "x", extra: 1 }));
  assert.throws(() => parseShadowSessionIpc({ sessionId: 123 }));
  assert.throws(() => parseShadowSessionIpc({ sessionId: "" }));
  assert.throws(() => parseShadowSessionIpc({}));
  assert.throws(() => parseShadowSessionIpc(null));
  assert.throws(() => parseShadowSessionIpc([]));
  assert.throws(() => parseShadowSessionIpc("shadow-abc-1"));
});

test("shadow:status accepts no payload or an empty object only", () => {
  assert.deepEqual(parseShadowStatusIpc(undefined), {});
  assert.deepEqual(parseShadowStatusIpc(null), {});
  assert.deepEqual(parseShadowStatusIpc({}), {});
  assert.throws(() => parseShadowStatusIpc({ sessionId: "x" }));
  assert.throws(() => parseShadowStatusIpc([]));
  assert.throws(() => parseShadowStatusIpc("status"));
});

test("a payload with an extra __proto__ key is rejected as an extra field, not silently stripped", () => {
  // JSON.parse turns a literal "__proto__" key into a real own property (not prototype
  // pollution), so the exact-key check above correctly rejects it like any other extra field.
  const malicious = JSON.parse('{"symbol":"KRW-BTC","strategyId":"sma-crossover","__proto__":{"polluted":true}}');
  assert.throws(() => parseShadowStartIpc(malicious));
  assert.equal({}.polluted, undefined);
});
