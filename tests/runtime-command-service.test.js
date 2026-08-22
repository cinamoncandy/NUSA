const test = require("node:test");
const assert = require("node:assert/strict");
const { ControlPlane } = require("../dist/apps/desktop/src/control/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { PaperScenarioEvidenceRecorder } = require("../dist/apps/desktop/src/paper/paperScenarioEvidenceRecorder.js");
const { RuntimeCommandService, PERSISTENCE_FAULT_MESSAGE, PERSISTENCE_RECOVERY_STEPS, PERSISTENCE_REPAIR_MESSAGE } = require("../dist/apps/desktop/src/control/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function harness(readiness) {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("sma-crossover");
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const durable = [];
  const evidenceEvents = [];
  const diagnostics = [];
  let fail = false;
  const persist = (paper, controlState, events = []) => {
    if (fail) throw new Error("injected SQLite write failure");
    durable.push({ paper: clone(paper), control: clone(controlState) });
    evidenceEvents.push(...events.map(clone));
  };
  const persistence = {
    save(paper, controlState) { persist(paper, controlState); },
    saveWithScenarioEvent(paper, controlState, event) { persist(paper, controlState, [event]); },
    saveWithScenarioEvents(paper, controlState, events) { persist(paper, controlState, events); }
  };
  const recorder = new PaperScenarioEvidenceRecorder({ append: (event) => {
    persist(broker.exportState(), control.exportState(), [event]);
    return { sequence: evidenceEvents.length, previousHash: "", event, hash: "" };
  } }, "paper-session-1");
  const runtime = new RuntimeCommandService(broker, control, strategy, persistence, { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) }, readiness, recorder, (diagnostic) => diagnostics.push(diagnostic));
  return {
    broker, control, strategy, durable, evidenceEvents, diagnostics, runtime,
    failNext: () => { fail = true; },
    // Simulates restore() itself throwing (e.g. a corrupted in-memory snapshot) -- distinct
    // from a plain persistence write failure, and only reachable by directly breaking one of
    // the real restore methods RuntimeCommandService calls internally.
    breakRestore: () => { broker.restoreState = () => { throw new Error("simulated rollback failure"); }; }
  };
}

test("automatic Paper BUY is blocked in a forbidden market regime", () => {
  const h = harness();
  h.runtime.start();
  h.runtime.setAutoTrade(true);
  const result = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, {
    type: "BUY", reason: "crossover", confidence: 1, timestamp: 100, regime: "STRONG_DOWNTREND"
  });
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.error, /NEW_EXPOSURE_BLOCKED_BY_REGIME/);
  assert.equal(h.broker.exportState().orders.length, 0);
});

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

test("kill switch records PASS only after strategy and auto trading are safely stopped", () => {
  const h = harness();
  h.runtime.start();
  h.runtime.setAutoTrade(true);
  h.runtime.stop();
  assert.equal(h.strategy.isRunning(), false);
  assert.equal(h.control.snapshot().status, "STOPPED");
  assert.equal(h.control.snapshot().autoTradeEnabled, false);
  const evidence = h.evidenceEvents.at(-1);
  assert.equal(evidence.type, "FAULT_SCENARIO_PASSED");
  assert.equal(evidence.scenario, "KILL_SWITCH");
  assert.equal(evidence.sessionId, "paper-session-1");
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

test("automatic fills and duplicate checks persist explicit scenario evidence", () => {
  const h = harness();
  h.runtime.start(); h.runtime.setOrderQuantity(0.01); h.runtime.setAutoTrade(true);
  const signal = { type: "BUY", reason: "test", confidence: 1, timestamp: 20 };
  const filled = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, signal);
  assert.equal(filled.outcome, "FILLED");
  assert.equal(h.evidenceEvents.length, 1);
  assert.equal(h.evidenceEvents[0].type, "ORDER_COMPLETED");
  assert.equal(h.evidenceEvents[0].eventId, filled.order.id);
  assert.equal(h.evidenceEvents[0].sessionId, "paper-session-1");

  const durableBeforeDuplicate = h.durable.length;
  const duplicate = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0.01, signal);
  assert.equal(duplicate.outcome, "DUPLICATE");
  assert.equal(h.durable.length, durableBeforeDuplicate + 1, "both duplicate evidence events must share one persistence transaction");
  assert.equal(h.evidenceEvents.length, 3);
  assert.equal(h.evidenceEvents[1].type, "DUPLICATE_ORDER_CHECKED");
  assert.match(h.evidenceEvents[1].eventId, /^duplicate-/);
  assert.equal(h.evidenceEvents[1].occurredAt, signal.timestamp);
  assert.equal(h.evidenceEvents[1].sessionId, "paper-session-1");
  assert.equal(h.evidenceEvents[2].type, "FAULT_SCENARIO_PASSED");
  assert.equal(h.evidenceEvents[2].scenario, "DUPLICATE_SIGNAL");
  assert.equal(h.evidenceEvents[2].sessionId, "paper-session-1");
});

test("duplicate evidence batch failure fails closed without partial evidence or account mutation", () => {
  const h = harness();
  h.runtime.start(); h.runtime.setOrderQuantity(0.01); h.runtime.setAutoTrade(true);
  const signal = { type: "BUY", reason: "test", confidence: 1, timestamp: 21 };
  assert.equal(h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, signal).outcome, "FILLED");
  const before = h.broker.exportState();
  const evidenceBefore = h.evidenceEvents.length;
  h.failNext();
  const duplicate = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0.01, signal);
  assert.equal(duplicate.outcome, "REJECTED");
  assert.equal(duplicate.error, PERSISTENCE_REPAIR_MESSAGE);
  assert.deepEqual(h.broker.exportState(), before);
  assert.equal(h.evidenceEvents.length, evidenceBefore);
  assert.equal(h.runtime.isAvailable(), false);
  assert.equal(h.control.snapshot().status, "FAULTED");
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

// WO-0021: a rollback failure (restore() itself throwing, on top of a persistence write
// failure) must still leave the runtime fail-closed, not silently fail-open. Before this
// fix, failClosed() was unreachable code whenever restore() threw, since it sat after an
// un-guarded this.restore(snapshot) call in the same catch block.
test("a rollback failure on top of a persistence failure still disables Paper Trading (manual command)", () => {
  const h = harness();
  h.failNext();
  h.breakRestore();
  assert.throws(() => h.runtime.manualOrder("BUY", 0.01, 50_000_000), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
  assert.equal(h.runtime.isAvailable(), false, "runtime must not remain available after a failed rollback");
  assert.equal(h.control.snapshot().status, "FAULTED");
  assert.equal(h.control.snapshot().autoTradeEnabled, false);
  assert.throws(() => h.runtime.manualOrder("BUY", 0.001, 1), new RegExp(PERSISTENCE_REPAIR_MESSAGE), "subsequent commands must still be rejected");
});

test("a rollback failure on top of a persistence failure still disables Paper Trading (automatic signal)", () => {
  const h = harness();
  h.runtime.start(); h.runtime.setOrderQuantity(0.01); h.runtime.setAutoTrade(true);
  h.failNext();
  h.breakRestore();
  const result = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 30 });
  assert.equal(result.outcome, "REJECTED");
  assert.equal(result.error, PERSISTENCE_REPAIR_MESSAGE);
  assert.equal(h.runtime.isAvailable(), false, "runtime must not remain available after a failed rollback");
  assert.equal(h.control.snapshot().status, "FAULTED");
  const stillSkipped = h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 31 });
  assert.equal(stillSkipped.outcome, "SKIPPED", "no further automatic execution after the runtime is disabled");
});

test("a persistence failure on a manual order emits mutation-failed, rollback-completed, and disabled diagnostics in order", () => {
  const h = harness();
  h.failNext();
  assert.throws(() => h.runtime.manualOrder("BUY", 0.01, 50_000_000));
  assert.deepEqual(h.diagnostics.map((d) => d.kind), [
    "PERSISTENCE_MUTATION_FAILED",
    "PERSISTENCE_ROLLBACK_COMPLETED",
    "PAPER_TRADING_DISABLED"
  ]);
  assert.equal(h.diagnostics[0].details.mutationName, "manual paper order");
  assert.equal(h.diagnostics[2].details.controlStatus, "FAULTED");
});

test("a rollback failure on a manual order emits a rollback-failed diagnostic instead of rollback-completed", () => {
  const h = harness();
  h.failNext();
  h.breakRestore();
  assert.throws(() => h.runtime.manualOrder("BUY", 0.01, 50_000_000));
  assert.deepEqual(h.diagnostics.map((d) => d.kind), [
    "PERSISTENCE_MUTATION_FAILED",
    "PERSISTENCE_ROLLBACK_FAILED",
    "PAPER_TRADING_DISABLED"
  ]);
  assert.equal(h.diagnostics[1].details.rollbackSucceeded, false);
  assert.match(h.diagnostics[1].details.restoreErrorMessage, /simulated rollback failure/);
});

test("a persistence failure on an automatic signal additionally emits automatic-execution-blocked", () => {
  const h = harness();
  h.runtime.start(); h.runtime.setOrderQuantity(0.01); h.runtime.setAutoTrade(true);
  h.failNext();
  h.runtime.automaticSignal("KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 40 });
  assert.deepEqual(h.diagnostics.map((d) => d.kind), [
    "PERSISTENCE_MUTATION_FAILED",
    "PERSISTENCE_ROLLBACK_COMPLETED",
    "PAPER_TRADING_DISABLED",
    "AUTOMATIC_EXECUTION_BLOCKED"
  ]);
});

test("a validation rejection (no persistence involved) emits no diagnostics and keeps the runtime available", () => {
  const h = harness();
  assert.throws(() => h.runtime.manualOrder("BUY", 999, 50_000_000), /insufficient paper cash/);
  assert.equal(h.diagnostics.length, 0);
  assert.equal(h.runtime.isAvailable(), true);
  assert.equal(h.control.snapshot().status, "STOPPED");
});
