const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { PaperSessionStore } = require("../dist/apps/desktop/src/paperSessionStore.js");
const { ControlSessionStore } = require("../dist/apps/desktop/src/controlSessionStore.js");
const { executeAutomaticPaperSignal } = require("../dist/apps/desktop/src/paperAutomation.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

test("paper broker buys, marks to market, and sells", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0.001);
  const buy = broker.execute("BUY", 0.01, 50_000_000, new Date("2026-01-01T00:00:00Z"));
  assert.equal(buy.fee, 500);
  let snapshot = broker.snapshot(55_000_000);
  assert.equal(snapshot.cash, 499_500);
  assert.equal(snapshot.position.quantity, 0.01);
  assert.equal(snapshot.unrealizedPnl, 50_000);
  broker.execute("SELL", 0.004, 60_000_000, new Date("2026-01-01T00:01:00Z"));
  snapshot = broker.snapshot(60_000_000);
  assert.equal(snapshot.position.quantity, 0.006);
  assert.equal(snapshot.position.realizedPnl, 39_760);
  assert.equal(snapshot.orders.length, 2);
});

test("paper broker blocks invalid and risky orders", () => {
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0, { maxOrderNotional: 1_000_000, maxPositionQuantity: 0.02 });
  assert.throws(() => broker.execute("BUY", 0, 1), /quantity must be positive/);
  assert.throws(() => broker.execute("BUY", 0.03, 50_000_000), /max order notional exceeded/);
  broker.execute("BUY", 0.01, 50_000_000);
  assert.throws(() => broker.execute("BUY", 0.011, 50_000_000), /max position quantity exceeded/);
  assert.throws(() => broker.execute("SELL", 0.1, 50_000_000), /insufficient paper position/);
});

test("paper broker state round-trips through atomic session store", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dokkaebi-paper-"));
  const filePath = path.join(directory, "paper-session.json");
  try {
    const original = new PaperBroker(1_000_000, "KRW-BTC", 0.001);
    original.execute("BUY", 0.01, 50_000_000, new Date("2026-01-01T00:00:00Z"));
    const store = new PaperSessionStore(filePath);
    store.save(original.exportState());
    const persisted = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.orders.length, 1);
    const restored = new PaperBroker(1_000_000, "KRW-BTC", 0.001, {}, store.load());
    assert.deepEqual(restored.exportState(), original.exportState());
    assert.equal(restored.snapshot(55_000_000).unrealizedPnl, 50_000);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SMA strategy warms up and emits crossover signals", () => {
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3), 10);
  engine.start();
  const feed = (price, timestamp) => engine.onTick({ market: "KRW-BTC", price, timestamp }, 0);
  assert.equal(feed(3, 1).type, "HOLD");
  assert.equal(feed(2, 2).type, "HOLD");
  assert.equal(feed(1, 3).type, "HOLD");
  assert.equal(feed(4, 4).type, "BUY");
  assert.equal(feed(1, 5).type, "HOLD");
  assert.equal(feed(0.5, 6).type, "SELL");
  assert.deepEqual(engine.getHistory(), [3, 2, 1, 4, 1, 0.5]);
});

test("control plane requires running strategy before auto trading", () => {
  const control = new ControlPlane("sma-crossover", 3);
  assert.throws(() => control.setAutoTrade(true), /strategy must be running/);
  control.start();
  control.setOrderQuantity(0.002);
  control.setAutoTrade(true);
  assert.equal(control.canAutoTrade(), true);
  assert.equal(control.snapshot().orderQuantity, 0.002);
  control.record("SIGNAL", "BUY crossover");
  control.record("ORDER", "paper fill");
  assert.equal(control.snapshot().events.length, 3);
  control.stop();
  assert.equal(control.snapshot().autoTradeEnabled, false);
});

test("malformed paper session fails closed with a visible diagnostic", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dokkaebi-corrupt-paper-"));
  const filePath = path.join(directory, "paper-session.json");
  try {
    writeFileSync(filePath, '{"version":1,"cash":', "utf8");
    const result = new PaperSessionStore(filePath).loadSafe();
    assert.equal(result.state, undefined);
    assert.match(result.diagnostic, /paper session recovery failed/);
    assert.equal(readFileSync(filePath, "utf8"), '{"version":1,"cash":');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("control start and stop state persists with events", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dokkaebi-control-"));
  const filePath = path.join(directory, "control-session.json");
  try {
    const store = new ControlSessionStore(filePath);
    const running = new ControlPlane("sma-crossover");
    running.start();
    store.save(running.exportState());
    const restoredRunning = new ControlPlane("sma-crossover", 200, store.loadSafe().state);
    assert.equal(restoredRunning.snapshot().status, "RUNNING");
    assert.match(restoredRunning.snapshot().events[0].message, /auto trading remains disabled/);
    restoredRunning.stop();
    store.save(restoredRunning.exportState());
    const restoredStopped = new ControlPlane("sma-crossover", 200, store.loadSafe().state);
    assert.equal(restoredStopped.snapshot().status, "STOPPED");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("automatic trading is always disabled after control restore", () => {
  const original = new ControlPlane("sma-crossover");
  original.start();
  original.setAutoTrade(true);
  const restored = new ControlPlane("sma-crossover", 200, original.exportState());
  assert.equal(restored.snapshot().status, "RUNNING");
  assert.equal(restored.snapshot().autoTradeEnabled, false);
  assert.equal(restored.canAutoTrade(), false);
});

test("one market signal cannot create duplicate automatic orders", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { maxOrderNotional: 1_000_000 });
  const control = new ControlPlane("sma-crossover");
  control.start();
  control.setOrderQuantity(0.01);
  control.setAutoTrade(true);
  const signal = { type: "BUY", reason: "test crossover", confidence: 1, timestamp: 1234 };
  assert.equal(executeAutomaticPaperSignal(control, broker, "KRW-BTC", 50_000_000, 0, signal).outcome, "FILLED");
  assert.equal(executeAutomaticPaperSignal(control, broker, "KRW-BTC", 50_000_000, 0, signal).outcome, "DUPLICATE");
  assert.equal(broker.exportState().orders.length, 1);
});

test("risk rejection is returned without throwing or mutating orders", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0, { maxOrderNotional: 100 });
  const control = new ControlPlane("sma-crossover");
  control.start();
  control.setOrderQuantity(0.01);
  control.setAutoTrade(true);
  const result = executeAutomaticPaperSignal(control, broker, "KRW-BTC", 50_000_000, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: 2 });
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.error, /max order notional exceeded/);
  assert.equal(broker.exportState().orders.length, 0);
});

test("malformed control state returns a diagnostic instead of restoring", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dokkaebi-corrupt-control-"));
  const filePath = path.join(directory, "control-session.json");
  try {
    writeFileSync(filePath, JSON.stringify({ version: 1, status: "RUNNING" }), "utf8");
    const result = new ControlSessionStore(filePath).loadSafe();
    assert.equal(result.state, undefined);
    assert.match(result.diagnostic, /control session recovery failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("faulted control plane fails closed until operator repair", () => {
  const control = new ControlPlane("sma-crossover");
  control.fault("paper session recovery failed");
  assert.throws(() => control.start(), /requires operator repair/);
  assert.throws(() => control.setAutoTrade(true), /strategy must be running/);
  assert.equal(control.canAutoTrade(), false);
});
