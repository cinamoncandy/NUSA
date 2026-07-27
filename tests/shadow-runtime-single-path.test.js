const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "apps/desktop/src/main.ts"), "utf8");
const runtime = fs.readFileSync(path.join(root, "apps/desktop/src/shadowOperationalRuntime.ts"), "utf8");

test("production uses one Shadow runtime and one official candle dispatch path", () => {
  assert.equal((main.match(/new ShadowOperationalRuntime\(/g) || []).length, 1);
  assert.ok((main.match(/shadowRuntime\.syncOfficialCandles\(/g) || []).length >= 1);
  assert.equal((main.match(/shadowRuntime\.onTicker\(/g) || []).length, 0);
  assert.match(main, /new UpbitMinuteCandleSource\(MARKET\)/);
  assert.match(runtime, /riskGate\.evaluate/);
  assert.doesNotMatch(runtime, /from ["']\.\/paperBroker["']/);
});

test("canonical runtime preserves the zero-mutation Shadow boundary", () => {
  assert.match(runtime, /actualBrokerCallCount: 0/);
  assert.match(runtime, /productionMutationAllowed: false/);
  assert.match(runtime, /verifyShadowPilotEvents/);
});
