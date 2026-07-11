const test = require("node:test");
const assert = require("node:assert/strict");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { RuntimeCommandService, PERSISTENCE_REPAIR_MESSAGE } = require("../dist/apps/desktop/src/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function harness() {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("sma-crossover");
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const durable = [];
  let fail = false;
  const persistence = { save(paper, controlState) {
    if (fail) throw new Error("injected SQLite write failure");
    durable.push({ paper: clone(paper), control: clone(controlState) });
  } };
  const runtime = new RuntimeCommandService(broker, control, strategy, persistence);
  return { broker, control, strategy, durable, runtime, failNext: () => { fail = true; } };
}

test("manual BUY persistence failure restores broker and preserves durable state", () => {
  const h = harness(); const before = h.broker.exportState(); h.failNext();
  assert.throws(() => h.runtime.manualOrder("BUY", 0.01, 50_000_000), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  assert.deepEqual(h.broker.exportState(), before);
  assert.equal(h.durable.length, 0); assert.equal(h.runtime.isAvailable(), false);
  assert.equal(h.control.snapshot().status, "FAULTED"); assert.equal(h.control.snapshot().autoTradeEnabled, false);
  assert.throws(() => h.runtime.manualOrder("BUY", 0.001, 1), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
});

test("manual SELL persistence failure restores quantity and realized pnl", () => {
  const h = harness(); h.runtime.manualOrder("BUY", 0.01, 50_000_000);
  const before = h.broker.exportState(); h.failNext();
  assert.throws(() => h.runtime.manualOrder("SELL", 0.005, 60_000_000), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  assert.deepEqual(h.broker.exportState(), before);
  assert.deepEqual(h.durable.at(-1).paper, clone(before));
});

test("failed control commands restore running state and durable command state", () => {
  for (const command of [
    (h) => h.runtime.start(),
    (h) => { h.runtime.start(); h.failNext(); h.runtime.stop(); },
    (h) => { h.runtime.start(); h.failNext(); h.runtime.setAutoTrade(true); },
    (h) => { h.runtime.start(); h.failNext(); h.runtime.setOrderQuantity(0.02); }
  ]) {
    const h = harness();
    if (command.toString().includes("h.runtime.start()")) { /* command sets its own setup */ }
    if (command.toString().includes("failNext")) {
      assert.throws(() => command(h), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
    } else {
      h.failNext(); assert.throws(() => command(h), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
    }
    assert.equal(h.runtime.isAvailable(), false);
    assert.equal(h.strategy.isRunning(), false);
    assert.equal(h.control.snapshot().status, "FAULTED");
  }
});

test("automatic signal does not claim or execute when persistence is unavailable", () => {
  const h = harness(); h.runtime.start(); h.runtime.setAutoTrade(true); h.failNext();
  assert.throws(() => h.runtime.setOrderQuantity(0.02), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  const before = h.broker.exportState();
  assert.equal(h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 1 }).outcome, "SKIPPED");
  assert.deepEqual(h.broker.exportState(), before);
  assert.equal(h.control.claimAutomaticSignal("KRW-BTC:1:BUY"), true);
});

test("automatic write failure restores broker and does not consume a signal key", () => {
  const h = harness(); h.runtime.start(); h.runtime.setOrderQuantity(0.01); h.runtime.setAutoTrade(true); h.failNext();
  const result = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 2 });
  assert.equal(result.outcome, "REJECTED"); assert.equal(result.error, PERSISTENCE_REPAIR_MESSAGE);
  assert.equal(h.broker.exportState().orders.length, 0); assert.equal(h.runtime.isAvailable(), false);
  assert.equal(h.control.claimAutomaticSignal("KRW-BTC:2:BUY"), true);
});

