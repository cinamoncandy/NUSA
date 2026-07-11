const test = require("node:test");
const assert = require("node:assert/strict");
const { runWalkForward } = require("../dist/apps/desktop/src/walkForwardEngine.js");

class FirstTickBuyer {
  constructor() { this.id = "buyer"; this.name = "Buyer"; this.index = 0; }
  onTick(tick) { this.index += 1; return { type: this.index === 1 ? "BUY" : "HOLD", reason: "test", confidence: 0, timestamp: tick.timestamp }; }
  reset() { this.index = 0; }
}
class NeverTrade {
  constructor() { this.id = "flat"; this.name = "Flat"; }
  onTick(tick) { return { type: "HOLD", reason: "test", confidence: 0, timestamp: tick.timestamp }; }
  reset() {}
}

const points = [100, 110, 120, 130, 140, 150, 160, 170].map((close, index) => ({ timestamp: index + 1, close }));
const candidates = [{ id: "buyer", createStrategy: () => new FirstTickBuyer() }, { id: "flat", createStrategy: () => new NeverTrade() }];

test("walk forward selects candidates on training only and evaluates non-overlapping test windows", () => {
  const first = runWalkForward(points, candidates, { trainingPoints: 3, testPoints: 2, backtest: { initialCash: 1_000, feeRate: 0, orderQuantity: 1 } });
  const replay = runWalkForward(points, candidates, { trainingPoints: 3, testPoints: 2, backtest: { initialCash: 1_000, feeRate: 0, orderQuantity: 1 } });
  assert.deepEqual(replay, first);
  assert.equal(first.summary.windows, 2);
  assert.deepEqual(first.summary.selectedCandidates, ["buyer", "buyer"]);
  assert.deepEqual(first.windows.map((window) => [window.trainingStart, window.trainingEnd, window.testStart, window.testEnd]), [[0, 3, 3, 5], [2, 5, 5, 7]]);
  assert.ok(first.summary.outOfSampleReturn > 0);
});

test("walk forward fails closed for overlap, incomplete data, and invalid candidates", () => {
  assert.throws(() => runWalkForward(points, candidates, { trainingPoints: 3, testPoints: 2, stepPoints: 1 }), /must not overlap/);
  assert.throws(() => runWalkForward(points.slice(0, 4), candidates, { trainingPoints: 3, testPoints: 2 }), /complete training/);
  assert.throws(() => runWalkForward(points, [], { trainingPoints: 3, testPoints: 2 }), /at least one candidate/);
  assert.throws(() => runWalkForward(points, [{ id: "x", createStrategy: () => new NeverTrade() }, { id: "x", createStrategy: () => new NeverTrade() }], { trainingPoints: 3, testPoints: 2 }), /unique/);
});

