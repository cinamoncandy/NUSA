const test = require("node:test");
const assert = require("node:assert/strict");
const { EmaCrossoverStrategy } = require("../dist/apps/server/src/emaCrossoverStrategy.js");
const { StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

function assertClose(actual, expected, epsilon = 1e-3) {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("EmaCrossoverStrategy implements TradingStrategy and is swappable into StrategyEngine", () => {
  const strategy = new EmaCrossoverStrategy(2, 3);
  assert.equal(strategy.id, "ema-crossover");
  assert.equal(strategy.name, "EMA Crossover");
  const engine = new StrategyEngine(strategy);
  engine.start();

  const prices = [10, 12, 8, 20, 5];
  const results = prices.map((price, index) => engine.onTick({ market: "KRW-BTC", price, timestamp: index }, 0));

  assert.equal(results[0].type, "HOLD");
  assert.equal(results[0].reason, "warming-up");
  assert.equal(results[1].type, "HOLD");
  assert.equal(results[1].reason, "warming-up");
  assert.equal(results[2].type, "HOLD");
  assert.equal(results[2].reason, "baseline-established");
  assert.equal(results[3].type, "BUY");
  assert.equal(results[3].reason, "short-EMA crossed above long-EMA");
  assertClose(results[3].confidence, 0.10983, 1e-3);
  assert.equal(results[4].type, "SELL");
  assert.equal(results[4].reason, "short-EMA crossed below long-EMA");
  assertClose(results[4].confidence, 0.10987, 1e-3);
});

test("EmaCrossoverStrategy rejects invalid periods", () => {
  assert.throws(() => new EmaCrossoverStrategy(1, 5), /invalid EMA periods/);
  assert.throws(() => new EmaCrossoverStrategy(5, 5), /invalid EMA periods/);
  assert.throws(() => new EmaCrossoverStrategy(2.5, 5), /invalid EMA periods/);
});

test("reset() clears EMA state and previousSpread so the next tick re-establishes a baseline", () => {
  const strategy = new EmaCrossoverStrategy(2, 3);
  const engine = new StrategyEngine(strategy);
  engine.start();
  for (const price of [10, 12, 8, 20]) engine.onTick({ market: "KRW-BTC", price, timestamp: 0 }, 0);
  strategy.reset();
  engine.setStrategy(strategy);
  const results = [10, 12, 8].map((price, index) => engine.onTick({ market: "KRW-BTC", price, timestamp: index }, 0));
  assert.equal(results[2].type, "HOLD");
  assert.equal(results[2].reason, "baseline-established");
});
