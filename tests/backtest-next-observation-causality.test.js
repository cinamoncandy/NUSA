const test = require("node:test");
const assert = require("node:assert/strict");
const { runBacktest } = require("../dist/apps/desktop/src/strategy/backtestEngine.js");

const points = [
  { timestamp: 1_000, close: 100 },
  { timestamp: 2_000, close: 200 },
  { timestamp: 3_000, close: 300 },
];

function scriptedStrategy(types) {
  let index = 0;
  return {
    id: "causality-test",
    name: "Causality Test",
    reset() { index = 0; },
    onTick(tick) {
      const type = types[index++] ?? "HOLD";
      return { type, reason: `script-${type}`, confidence: type === "HOLD" ? 0 : 1, timestamp: tick.timestamp };
    },
  };
}

test("signal from observation t executes only at observation t+1", () => {
  const result = runBacktest(points, () => scriptedStrategy(["BUY", "HOLD", "HOLD"]), {
    initialCash: 1_000,
    feeRate: 0,
    orderQuantity: 0.001,
  });

  assert.deepEqual(result.decisions.map((decision) => decision.outcome), ["HOLD", "FILLED", "HOLD"]);
  assert.equal(result.decisions[0].order, undefined);
  assert.equal(result.decisions[1].signal.timestamp, points[0].timestamp);
  assert.equal(result.decisions[1].timestamp, points[1].timestamp);
  assert.equal(result.decisions[1].price, points[1].close);
  assert.equal(result.decisions[1].executionPrice, points[1].close);
  assert.equal(result.decisions[1].order.price, points[1].close);
});

test("signal generated on the terminal observation remains unfilled", () => {
  const result = runBacktest(points, () => scriptedStrategy(["HOLD", "HOLD", "BUY"]), {
    initialCash: 1_000,
    feeRate: 0,
    orderQuantity: 0.001,
  });

  assert.equal(result.metrics.fillCount, 0);
  assert.equal(result.decisions.at(-1).outcome, "HOLD");
  assert.equal(result.decisions.at(-1).order, undefined);
  assert.equal(result.finalPaperState.position.quantity, 0);
});
