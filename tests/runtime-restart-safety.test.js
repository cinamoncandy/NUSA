const test = require("node:test");
const assert = require("node:assert/strict");
const { ControlPlane } = require("../dist/apps/desktop/src/control/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { RuntimeCommandService } = require("../dist/apps/desktop/src/control/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");

// Reproduces the composition-root wiring used by apps/desktop/src/main.ts's
// initializeRuntime(): a strategy that was RUNNING with auto trading ON before
// shutdown is restored, the strategy resumes (read-only signal generation),
// but no order path may execute before explicit operator action.
function composeFromPersistedSession(persistedControlState) {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("sma-crossover", 200, persistedControlState);
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const durable = [];
  const persistence = { save(paper, controlState) { durable.push({ paper, controlState }); } };
  const runtime = new RuntimeCommandService(broker, control, strategy, persistence, { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) });
  if (control.snapshot().status === "RUNNING") strategy.start();
  return { broker, control, strategy, runtime, durable };
}

function priorSessionControlState() {
  const control = new ControlPlane("sma-crossover");
  control.start();
  control.setAutoTrade(true);
  return control.exportState();
}

test("restart resumes a RUNNING strategy but forces auto trading off", () => {
  const { control, strategy } = composeFromPersistedSession(priorSessionControlState());
  assert.equal(strategy.isRunning(), true, "strategy warm-up should resume so indicators are ready");
  assert.equal(control.snapshot().status, "RUNNING");
  assert.equal(control.snapshot().autoTradeEnabled, false, "auto trading must never restore enabled");
  assert.equal(control.canAutoTrade(), false);
});

test("no automatic order executes across the composed runtime after restart, even with a live crossover signal", () => {
  const { strategy, runtime, broker, durable } = composeFromPersistedSession(priorSessionControlState());
  const feed = (price, timestamp) => strategy.onTick({ market: "KRW-BTC", price, timestamp }, 0);

  // Warm up and force a BUY crossover, mirroring the SMA(2,3) sequence used elsewhere in this suite.
  feed(3, 1);
  feed(2, 2);
  feed(1, 3);
  const signal = feed(4, 4);
  assert.equal(signal.type, "BUY", "test setup must actually produce a directional signal");

  const result = runtime.automaticSignal("KRW-BTC", 4, 0, signal);
  assert.equal(result.outcome, "SKIPPED");
  assert.equal(broker.snapshot(4).position.quantity, 0, "no Paper position may open before an explicit operator action");
  assert.equal(durable.at(-1)?.paper.orders.length ?? 0, 0);
});

test("automatic trading resumes only after an explicit post-restart operator command", () => {
  const { control, strategy, runtime, broker } = composeFromPersistedSession(priorSessionControlState());

  const blocked = runtime.automaticSignal("KRW-BTC", 4, 0, { type: "BUY", reason: "crossover", confidence: 1, timestamp: 1 });
  assert.equal(blocked.outcome, "SKIPPED");

  runtime.setAutoTrade(true);
  assert.equal(control.snapshot().autoTradeEnabled, true);
  assert.equal(strategy.isRunning(), true);

  const allowed = runtime.automaticSignal("KRW-BTC", 4, 0, { type: "BUY", reason: "crossover", confidence: 1, timestamp: 2 });
  assert.equal(allowed.outcome, "FILLED");
  assert.ok(broker.snapshot(4).position.quantity > 0);
});

test("a STOPPED prior session restarts with the strategy not running and auto trading off", () => {
  const control = new ControlPlane("sma-crossover");
  control.start();
  control.setAutoTrade(true);
  control.stop();
  const { control: restoredControl, strategy } = composeFromPersistedSession(control.exportState());
  assert.equal(restoredControl.snapshot().status, "STOPPED");
  assert.equal(strategy.isRunning(), false);
  assert.equal(restoredControl.snapshot().autoTradeEnabled, false);
});
