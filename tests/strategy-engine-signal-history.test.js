const test = require("node:test");
const assert = require("node:assert/strict");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");

function tick(price, timestamp) {
  return { market: "KRW-BTC", price, timestamp };
}

test("getSignalHistory records only transitions, not every repeated HOLD", () => {
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  engine.start();
  for (let index = 0; index < 10; index += 1) engine.onTick(tick(100, index), 0);
  const history = engine.getSignalHistory();
  assert.ok(history.length < 10, "repeated identical HOLD signals must not each be recorded");
  assert.ok(history.every((entry) => entry.type === "HOLD"));
});

test("getSignalHistory captures a BUY/SELL transition", () => {
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  engine.start();
  engine.onTick(tick(100, 1), 0);
  engine.onTick(tick(100, 2), 0);
  engine.onTick(tick(100, 3), 0);
  engine.onTick(tick(200, 4), 0);
  const history = engine.getSignalHistory();
  assert.ok(history.some((entry) => entry.type === "BUY"));
});

test("getSignalHistory is bounded and reset by setStrategy", () => {
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3), 500, 3);
  engine.start();
  let timestamp = 1;
  for (let index = 0; index < 20; index += 1) {
    engine.onTick(tick(100 + (index % 2 === 0 ? 50 : -50), timestamp), 0);
    timestamp += 1;
  }
  assert.ok(engine.getSignalHistory().length <= 3);
  engine.setStrategy(new SmaCrossoverStrategy(2, 3));
  assert.deepEqual(engine.getSignalHistory(), []);
});
