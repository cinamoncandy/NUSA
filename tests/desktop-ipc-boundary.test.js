const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

test("desktop IPC rejects coerced control values and public market data remains observable during Paper recovery", () => {
  const source = readFileSync("apps/desktop/src/main.ts", "utf8");
  assert.match(source, /typeof enabled !== "boolean"/);
  assert.match(source, /typeof quantity !== "number" \|\| !Number\.isFinite\(quantity\)/);
  assert.match(source, /typeof candidate\.quantity !== "number" \|\| !Number\.isFinite\(candidate\.quantity\)/);
  assert.doesNotMatch(source, /setAutoTrade\(Boolean\(enabled\)\)/);
  assert.match(source, /Public market data is safe to observe even while Paper execution is unavailable/);
  assert.match(source, /\n\s*stream\.start\(\);/);
  assert.doesNotMatch(source, /if \(paperTradingAvailable\) stream\.start\(\)/);
  assert.doesNotMatch(source, /fetch\(|axios|Authorization|jwt|withdraw/i);
});

test("mutating IPC commands are not automatically retried", () => {
  const source = readFileSync("apps/desktop/src/preload.ts", "utf8");
  assert.match(source, /const invokeMutation/);
  assert.match(source, /placeOrder: .*invokeMutation\("paper:order"/);
  assert.match(source, /startStrategy: \(\) => invokeMutation\("control:start"\)/);
  assert.match(source, /stopStrategy: \(\) => invokeMutation\("control:stop"\)/);
  assert.match(source, /setAutoTrade: .*invokeMutation\("control:auto"/);
  assert.match(source, /setStrategyQuantity: .*invokeMutation\("control:quantity"/);
  assert.doesNotMatch(source, /placeOrder: .*invokeReadWithRecovery/);
});

test("desktop execution requires fresh connected market data and a runtime readiness provider", () => {
  const source = readFileSync("apps/desktop/src/main.ts", "utf8");
  assert.match(source, /function assertFreshMarketData\(\)/);
  assert.match(source, /if \(!websocketConnected\) throw new Error\("market data connection is unavailable"\)/);
  assert.match(source, /market price is stale; wait for a fresh ticker/);
  assert.match(source, /if \(enabled\) assertFreshMarketData\(\)/);
  assert.match(source, /evaluateOperationalReadiness\(input\)/);
  assert.doesNotMatch(source, /\}, undefined, evidenceRecorder\)/);
  assert.match(source, /status\.startsWith\("stale"\)/);
});
