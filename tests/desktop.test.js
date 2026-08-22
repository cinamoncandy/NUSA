const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ControlPlane } = require("../dist/apps/desktop/src/control/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { PaperSessionStore } = require("../dist/apps/desktop/src/paper/paperSessionStore.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");

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
  assert.throws(() => broker.execute("SELL", 0.02, 50_000_000), /insufficient paper position/);
});

test("paper broker state round-trips through atomic session store", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nusa-paper-"));
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
