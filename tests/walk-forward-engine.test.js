const test = require("node:test");
const assert = require("node:assert/strict");
const { createWalkForwardWindows, runWalkForward } = require("../dist/apps/desktop/src/strategy/walkForwardEngine.js");
const { runBacktest } = require("../dist/apps/desktop/src/strategy/backtestEngine.js");

class FirstBuy { constructor() { this.id = "first-buy"; this.name = "First Buy"; this.index = 0; } onTick(tick) { this.index += 1; return { type: this.index === 1 ? "BUY" : "HOLD", reason: "first", confidence: 0, timestamp: tick.timestamp }; } reset() { this.index = 0; } }
class FirstRoundTrip { constructor() { this.id = "round-trip"; this.name = "Round Trip"; this.index = 0; } onTick(tick) { this.index += 1; return { type: this.index === 1 ? "BUY" : this.index === 2 ? "SELL" : "HOLD", reason: "round", confidence: 0, timestamp: tick.timestamp }; } reset() { this.index = 0; } }
class LateRoundTrip { constructor() { this.id = "late-round-trip"; this.name = "Late Round Trip"; this.index = 0; } onTick(tick) { this.index += 1; return { type: this.index === 2 ? "BUY" : this.index === 3 ? "SELL" : "HOLD", reason: "late", confidence: 0, timestamp: tick.timestamp }; } reset() { this.index = 0; } }
class Flat { constructor() { this.id = "flat"; this.name = "Flat"; } onTick(tick) { return { type: "HOLD", reason: "flat", confidence: 0, timestamp: tick.timestamp }; } reset() {} }
class Invalid { reset() {} }
class SeenCount { constructor() { this.id = "seen-count"; this.name = "Seen Count"; this.seen = 0; } onTick(tick) { this.seen += 1; return { type: "HOLD", reason: `seen-${this.seen}`, confidence: 0, timestamp: tick.timestamp }; } reset() { this.seen = 0; } }
class WarmupBuyer { constructor() { this.id = "warmup-buyer"; this.name = "Warmup Buyer"; } onTick(tick) { return { type: tick.timestamp < 4 ? "BUY" : "HOLD", reason: tick.timestamp < 4 ? "warmup-buy" : "scored-hold", confidence: 0, timestamp: tick.timestamp }; } reset() {} }

const points = (values) => values.map((close, index) => ({ timestamp: index + 1, close }));
const candidates = () => [{ id: "buyer", strategyFactory: () => new FirstBuy() }, { id: "flat", strategyFactory: () => new Flat() }, { id: "round", strategyFactory: () => new FirstRoundTrip() }];
const config = { trainSize: 3, testSize: 2, stepSize: 2, backtestConfig: { initialCash: 1000, feeRate: 0, orderQuantity: 1 } };

test("1 rolling window creation is deterministic", () => { const plan = createWalkForwardWindows(points([1,2,3,4,5,6,7,8]), config); assert.deepEqual(plan.windows.map(w => [w.trainStart,w.trainEnd,w.testStart,w.testEnd]), [[0,2,3,4],[2,4,5,6]]); });
test("2 anchored window creation expands train history", () => { const plan = createWalkForwardWindows(points([1,2,3,4,5,6,7,8]), { ...config, anchored: true }); assert.deepEqual(plan.windows.map(w => [w.trainStart,w.trainEnd,w.testStart,w.testEnd]), [[0,2,3,4],[0,4,5,6]]); });
test("3 train and test windows never overlap", () => { for (const w of createWalkForwardWindows(points([1,2,3,4,5,6,7,8]), config).windows) assert.ok(w.trainEnd < w.testStart && w.testStart <= w.testEnd); });
test("4 incomplete final test window is excluded with warning", () => { const result = createWalkForwardWindows(points([1,2,3,4,5,6]), config); assert.equal(result.windows.length, 1); assert.deepEqual(result.warnings, ["INCOMPLETE_TEST_WINDOW_EXCLUDED"]); });
test("5 insufficient data fails closed", () => { assert.throws(() => createWalkForwardWindows(points([1,2,3,4]), config), /minimum complete windows/); });
test("6 deterministic replay", () => { const input = points([10,11,12,13,14,15,16,17]); assert.deepEqual(runWalkForward(input, candidates(), config), runWalkForward(input, candidates(), config)); });
test("7 superior train candidate is selected", () => { const result = runWalkForward(points([10,12,14,16,18,20,22,24]), candidates(), config); assert.equal(result.windows[0].selectedCandidateId, "round"); });
test("8 changing test prices cannot change that window selection", () => { const base = points([10,12,14,16,18]); const changed = points([10,12,14,1600,1800]); const a = runWalkForward(base, candidates(), config); const b = runWalkForward(changed, candidates(), config); assert.equal(a.windows[0].selectedCandidateId, b.windows[0].selectedCandidateId); });
test("9 lexical id breaks equal train-score ties", () => { const equal = [{ id: "zeta", strategyFactory: () => new Flat() }, { id: "alpha", strategyFactory: () => new Flat() }]; assert.equal(runWalkForward(points([1,2,3,4,5]), equal, { ...config, selectionPolicy: { minimumClosedTrades: 0 } }).windows[0].selectedCandidateId, "alpha"); });
test("10 execution costs are included in train candidate scoring", () => { const result = runWalkForward(points([10,12,14,16,18]), candidates(), { ...config, backtestConfig: { initialCash: 1000, feeRate: 0.01, orderQuantity: 1, executionCosts: { spreadBps: 20, slippageBps: 30 } } }); assert.ok(result.windows[0].trainResult.metrics.totalTradingCost > 0); });
test("11 combined OOS metrics exist", () => { const result = runWalkForward(points([10,12,14,16,18,20,22,24]), candidates(), config); assert.equal(result.combinedOutOfSampleMetrics.windowCount, 2); assert.equal(result.combinedOutOfSampleMetrics.totalOosPoints, 4); });
test("12 sequential compounded metrics are distinct from equal weight metrics", () => { const result = runWalkForward(points([10,12,14,16,18,20,22,24]), candidates(), config); assert.ok(Number.isFinite(result.combinedOutOfSampleMetrics.sequentialCompounded.totalReturn)); assert.ok(Number.isFinite(result.combinedOutOfSampleMetrics.equalWeight.averageReturn)); });
test("13 candidate selection counts are complete", () => { const result = runWalkForward(points([10,12,14,16,18,20,22,24]), candidates(), config); assert.equal(Object.values(result.candidateSelectionCounts).reduce((a,b)=>a+b,0), result.windows.length); });
test("14 train success with repeatedly negative OOS emits divergence warning", () => { const result = runWalkForward(points([10,10,20,20,10,5,20,10,5]), [{ id: "round", strategyFactory: () => new FirstRoundTrip() }], { ...config, trainSize: 3, testSize: 3, stepSize: 3 }); assert.ok(result.warnings.includes("TRAIN_OOS_PERFORMANCE_DIVERGENCE")); });
test("15 frequent selected-candidate changes emit churn warning", () => { const alternating = [{ id: "early", strategyFactory: () => new FirstRoundTrip() }, { id: "late", strategyFactory: () => new LateRoundTrip() }]; const result = runWalkForward(points([100,100,200,210,420,430,860,870,1740,1750]), alternating, { ...config, trainSize: 4, testSize: 1, stepSize: 1, backtestConfig: { initialCash: 100000, feeRate: 0, orderQuantity: 1 } }); assert.ok(result.warnings.includes("HIGH_SELECTION_CHURN")); });
test("16 open positions remain open and are never force closed", () => { const result = runWalkForward(points([10,12,14,16,18]), [{ id: "buyer", strategyFactory: () => new FirstBuy() }], { ...config, selectionPolicy: { minimumClosedTrades: 0 } }); assert.equal(result.windows[0].testResult.openPosition.status, "OPEN_POSITION"); assert.equal(result.windows[0].testResult.trades.length, 0); });
test("17 timestamp regressions are rejected", () => { assert.throws(() => createWalkForwardWindows([{ timestamp: 2, close: 1 }, { timestamp: 1, close: 1 }, { timestamp: 3, close: 1 }, { timestamp: 4, close: 1 }, { timestamp: 5, close: 1 }], config), /strictly increasing/); });
test("18 duplicate candidate ids are rejected", () => { assert.throws(() => runWalkForward(points([1,2,3,4,5]), [{ id: "x", strategyFactory: () => new Flat() }, { id: "x", strategyFactory: () => new Flat() }], config), /unique/); });
test("19 invalid candidate factories fail with candidate id", () => { assert.throws(() => runWalkForward(points([1,2,3,4,5]), [{ id: "bad", strategyFactory: () => new Invalid() }], config), /candidate bad failed/); });
test("20 overlapping OOS windows are rejected", () => { assert.throws(() => createWalkForwardWindows(points([1,2,3,4,5,6]), { ...config, stepSize: 1 }), /must not overlap/); });


test("21 OOS first tick has continuous point-in-time strategy state", () => {
  const input = points([10,11,12,13,14,15,16]);
  const result = runWalkForward(input, [{ id: "seen", strategyFactory: () => new SeenCount() }], { ...config, selectionPolicy: { minimumClosedTrades: 0 } });
  assert.equal(result.windows[0].testResult.decisions[0].signal.reason, "seen-4");
  assert.equal(result.windows[1].testResult.decisions[0].signal.reason, "seen-6");
  assert.equal(result.windows[1].window.warmupPoints.length, 5);
  assert.ok(result.windows[1].window.warmupPoints.every((point) => point.timestamp < result.windows[1].window.testPoints[0].timestamp));
});

test("22 warm-up signals cannot create OOS trades costs PnL or alter benchmark denominator", () => {
  const input = points([10,11,12,13,14]);
  const cfg = { ...config, selectionPolicy: { minimumClosedTrades: 0 }, backtestConfig: { initialCash: 1000, feeRate: 0.01, orderQuantity: 1, executionCosts: { spreadBps: 20, slippageBps: 30 } } };
  const result = runWalkForward(input, [{ id: "warmup", strategyFactory: () => new WarmupBuyer() }], cfg);
  const oos = result.windows[0].testResult;
  const baseline = runBacktest(result.windows[0].window.testPoints, () => new Flat(), cfg.backtestConfig);
  assert.equal(oos.metrics.fillCount, 0);
  assert.equal(oos.metrics.turnover, 0);
  assert.equal(oos.metrics.feesPaid, 0);
  assert.equal(oos.metrics.spreadCost, 0);
  assert.equal(oos.metrics.slippageCost, 0);
  assert.equal(oos.metrics.totalReturn, 0);
  assert.equal(oos.finalPaperState.orders.length, 0);
  assert.equal(oos.benchmark.buyAndHoldReturn, baseline.benchmark.buyAndHoldReturn);
  assert.equal(oos.equityCurve[0].timestamp, result.windows[0].window.testPoints[0].timestamp);
});

test("23 backtest rejects warm-up that reaches into scored interval", () => {
  assert.throws(() => runBacktest(points([3,4]), () => new Flat(), { warmupPoints: points([1,2,3]) }), /strictly before scored points/);
});
