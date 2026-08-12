const test = require("node:test");
const assert = require("node:assert/strict");
const { applyExecutionCost, validateExecutionCostModel, ZERO_EXECUTION_COST } = require("../dist/apps/desktop/src/executionCostModel.js");
const { runBacktest } = require("../dist/apps/desktop/src/backtestEngine.js");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { RuntimeCommandService } = require("../dist/apps/desktop/src/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

const MODEL = { spreadBps: 20, slippageBps: 5 };

// Always-ALLOW risk gate, standing in for the real independent/canonical gates -- this file is
// about execution-cost pricing, not risk gating (see cloud-paper-risk-gate-wiring.test.js and
// runtime-command-risk-gate.test.js for that).
const permissiveRiskGate = { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) };

test("execution cost always moves the fill against the trader, never in their favour", () => {
  const buy = applyExecutionCost("BUY", 100_000_000, MODEL);
  const sell = applyExecutionCost("SELL", 100_000_000, MODEL);
  assert.ok(buy.executedPrice > buy.referencePrice, "a buyer must pay more than the reference price");
  assert.ok(sell.executedPrice < sell.referencePrice, "a seller must receive less than the reference price");
  // half the spread plus full slippage, applied symmetrically
  assert.equal(buy.adverseRate, 20 / 20_000 + 5 / 10_000);
  assert.equal(buy.referencePrice - sell.executedPrice, buy.executedPrice - buy.referencePrice);
});

test("a zero-cost model is labelled rather than presented as a clean result", () => {
  const free = applyExecutionCost("BUY", 100_000_000, ZERO_EXECUTION_COST);
  assert.equal(free.executedPrice, free.referencePrice);
  assert.equal(free.warning, "EXECUTION_COST_NOT_MODELED");

  const priced = applyExecutionCost("BUY", 100_000_000, MODEL);
  assert.equal(priced.warning, undefined);
});

test("invalid cost models are rejected instead of silently normalised", () => {
  assert.throws(() => validateExecutionCostModel({ spreadBps: -1, slippageBps: 0 }), /non-negative/);
  assert.throws(() => validateExecutionCostModel({ spreadBps: 0, slippageBps: Number.NaN }), /non-negative/);
  // a model this large would make a sell fill at or below zero
  assert.throws(() => validateExecutionCostModel({ spreadBps: 19_000, slippageBps: 600 }), /non-positive sell price/);
});

test("live paper and backtest fill at the same price under the same cost model", () => {
  // This is the property that matters: a strategy validated in backtest at a given cost model
  // must not report better fills once it runs live in paper purely because the two paths priced
  // execution differently. Both must route through the same model.
  const referencePrice = 83_214_567;
  const quantity = 0.01;

  const backtestBroker = new PaperBroker(1_000_000_000, "KRW-BTC", 0);
  const backtestFillPrice = applyExecutionCost("BUY", referencePrice, MODEL).executedPrice;
  const backtestOrder = backtestBroker.execute("BUY", quantity, backtestFillPrice);

  const liveBroker = new PaperBroker(1_000_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("sma-crossover");
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const persistence = { save() {} };
  const runtime = new RuntimeCommandService(liveBroker, control, strategy, persistence, permissiveRiskGate, undefined, undefined, undefined, MODEL);
  const liveOrder = runtime.manualOrder("BUY", quantity, referencePrice);

  assert.equal(liveOrder.price, backtestOrder.price);
  assert.equal(liveOrder.price, backtestFillPrice);
  assert.ok(liveOrder.price > referencePrice, "the live fill must include the adverse adjustment");
});

test("a live runtime with no cost model configured still reports its basis, and fills unchanged", () => {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0);
  const runtime = new RuntimeCommandService(broker, new ControlPlane("sma-crossover"), new StrategyEngine(new SmaCrossoverStrategy(2, 3)), { save() {} }, permissiveRiskGate);
  assert.deepEqual(runtime.getExecutionCostModel(), ZERO_EXECUTION_COST);
  // default stays free so this change alters no existing behaviour, but the basis is now
  // inspectable rather than an unstated assumption
  const order = runtime.manualOrder("BUY", 0.01, 83_214_567);
  assert.equal(order.price, 83_214_567);
});

test("a replayed reconnect order also prices through the configured cost model", () => {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0);
  const runtime = new RuntimeCommandService(broker, new ControlPlane("sma-crossover"), new StrategyEngine(new SmaCrossoverStrategy(2, 3)), { save() {} }, permissiveRiskGate, undefined, undefined, undefined, MODEL);
  const order = runtime.replayOrder("BUY", 0.01, 83_214_567);
  assert.equal(order.price, applyExecutionCost("BUY", 83_214_567, MODEL).executedPrice);
});

test("the risk gate sees the cost-adjusted price, not the raw reference price", () => {
  const seen = [];
  const observingGate = { evaluate: (command) => { seen.push(command.price); return { status: "ALLOW", reasonCodes: [] }; } };
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0);
  const runtime = new RuntimeCommandService(broker, new ControlPlane("sma-crossover"), new StrategyEngine(new SmaCrossoverStrategy(2, 3)), { save() {} }, observingGate, undefined, undefined, undefined, MODEL);
  runtime.manualOrder("BUY", 0.01, 83_214_567);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], applyExecutionCost("BUY", 83_214_567, MODEL).executedPrice);
});

test("backtest pricing is unchanged by the refactor to the shared model", () => {
  const points = Array.from({ length: 40 }, (_, i) => ({ timestamp: 1_700_000_000_000 + i * 60_000, close: 83_000_000 + Math.sin(i / 3) * 500_000 }));
  const config = { market: "KRW-BTC", initialCash: 1_000_000_000, orderQuantity: 0.01, feeRate: 0.0005, executionCosts: MODEL };
  const first = runBacktest(points, () => new SmaCrossoverStrategy(2, 5), config);
  const second = runBacktest(points, () => new SmaCrossoverStrategy(2, 5), config);
  assert.deepEqual(first.metrics, second.metrics, "backtest must remain deterministic");

  const filled = first.decisions.filter((entry) => entry.outcome === "FILLED");
  assert.ok(filled.length > 0, "the fixture should produce at least one fill");
  for (const entry of filled) {
    const expected = applyExecutionCost(entry.order.side, entry.price, MODEL).executedPrice;
    assert.equal(entry.order.price, expected, "every backtest fill must price through the shared model");
    assert.equal(entry.executionPrice, expected);
  }
});
