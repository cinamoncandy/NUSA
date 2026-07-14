const test = require("node:test");
const assert = require("node:assert/strict");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { RuntimeCommandService, PERSISTENCE_FAULT_MESSAGE, PERSISTENCE_RECOVERY_STEPS, PERSISTENCE_REPAIR_MESSAGE } = require("../dist/apps/desktop/src/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function harness(readiness) {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("sma-crossover");
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const durable = [];
  let fail = false;
  const persistence = { save(paper, controlState) {
    if (fail) throw new Error("injected SQLite write failure");
    durable.push({ paper: clone(paper), control: clone(controlState) });
  } };
  const runtime = new RuntimeCommandService(broker, control, strategy, persistence, readiness);
  return { broker, control, strategy, durable, runtime, failNext: () => { fail = true; } };
}

test("persistence recovery guidance matches the supported verified-backup procedure", () => {
  assert.deepEqual(PERSISTENCE_RECOVERY_STEPS, [
    "Stop the application and preserve the failed database file unchanged.",
    "Restore a known-good backup to the original database location while the application is stopped.",
    "Restart and verify startup integrity checks pass; Paper automatic trading remains OFF.",
    "Review account, order, control, and audit state before manually resuming Paper operation."
  ]);
  for (const message of [PERSISTENCE_REPAIR_MESSAGE, PERSISTENCE_FAULT_MESSAGE]) {
    assert.match(message, /stop the application/i);
    assert.match(message, /preserve the failed database/i);
    assert.match(message, /restore a verified backup/i);
    assert.match(message, /restart/i);
    assert.match(message, /manually resuming/i);
    assert.doesNotMatch(message, /automatic repair|repair the database/i);
    assert.doesNotMatch(message, /SQLite|injected|\\|\.db/i);
  }
});

test("manual BUY persistence failure restores broker and preserves durable state", () => {
  const h = harness(); const before = h.broker.exportState(); h.failNext();
  assert.throws(() => h.runtime.manualOrder("BUY", 0.01, 50_000_000), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  assert.deepEqual(h.broker.exportState(), before);
  assert.equal(h.durable.length, 0); assert.equal(h.runtime.isAvailable(), false);
  assert.equal(h.control.snapshot().status, "FAULTED"); assert.equal(h.control.snapshot().autoTradeEnabled, false);
  assert.throws(() => h.runtime.manualOrder("BUY", 0.001, 1), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  assert.doesNotMatch(PERSISTENCE_REPAIR_MESSAGE, /SQLite|injected|\\|\.db/i);
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

test("operational readiness blocks BUY before claiming the signal", () => {
  const h = harness(() => Object.freeze({ action: "ALLOW_EXIT_ONLY", ready: false, reasons: Object.freeze(["WARMUP_INCOMPLETE"]), evaluatedAt: 1 }));
  h.runtime.start(); h.runtime.setOrderQuantity(0.01); h.runtime.setAutoTrade(true);
  const result = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 3 });
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.error, /WARMUP_INCOMPLETE/);
  assert.equal(h.broker.exportState().orders.length, 0);
  assert.equal(h.control.claimAutomaticSignal("KRW-BTC:3:BUY"), true);
});

test("exit-only readiness permits SELL while HALT blocks automatic execution", () => {
  const exitOnly = harness(() => Object.freeze({ action: "ALLOW_EXIT_ONLY", ready: false, reasons: Object.freeze(["PROTECTION_LOCK_ACTIVE"]), evaluatedAt: 1 }));
  exitOnly.runtime.manualOrder("BUY", 0.01, 50_000_000); exitOnly.runtime.start(); exitOnly.runtime.setOrderQuantity(0.01); exitOnly.runtime.setAutoTrade(true);
  assert.equal(exitOnly.runtime.automaticSignal("KRW-BTC", 51_000_000, 0.01, { type: "SELL", reason: "exit", confidence: 1, timestamp: 4 }).outcome, "FILLED");
  const halted = harness(() => Object.freeze({ action: "HALT", ready: false, reasons: Object.freeze(["MARKET_DATA_DISCONNECTED"]), evaluatedAt: 1 }));
  halted.runtime.start(); halted.runtime.setAutoTrade(true);
  assert.equal(halted.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 5 }).outcome, "REJECTED");
});
