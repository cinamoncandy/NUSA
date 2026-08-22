const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

const dbPath = () => join(mkdtempSync(join(tmpdir(), "nusa-strategy-state-")), "runtime.db");

test("StrategyEngine.restoreHistory replaces price history and is bounded by maxHistory", () => {
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3), 3);
  engine.restoreHistory([1, 2, 3, 4, 5]);
  assert.deepEqual(engine.getHistory(), [3, 4, 5]);
});

test("StrategyEngine ignores an identical tick after the first evaluation", () => {
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3), 10);
  engine.start();
  const tick = { market: "KRW-BTC", price: 10, timestamp: 1 };
  const first = engine.onTick(tick, 0);
  const second = engine.onTick(tick, 0);
  assert.deepEqual(second, first);
  assert.equal(engine.getHistory().length, 1);
});

test("SMA signals remain deterministic after allocation-free rolling calculation", () => {
  const first = new StrategyEngine(new SmaCrossoverStrategy(2, 3), 10);
  const second = new StrategyEngine(new SmaCrossoverStrategy(2, 3), 10);
  first.start();
  second.start();
  for (const [index, price] of [10, 11, 12, 11, 10, 9].entries()) {
    const tick = { market: "KRW-BTC", price, timestamp: index + 1 };
    assert.deepEqual(first.onTick(tick, 0), second.onTick(tick, 0));
  }
});

test("restoreHistory rejects non-positive or non-finite prices", () => {
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  assert.throws(() => engine.restoreHistory([1, 0, 2]), /positive finite/);
  assert.throws(() => engine.restoreHistory([1, Number.NaN]), /positive finite/);
});

test("restored history skips re-warm-up; only previousSpread needs one extra tick to re-establish", () => {
  // Same price sequence and expected signals as tests/desktop.test.js's SMA warm-up case
  // (feed(3),feed(2),feed(1) -> HOLD warming-up/baseline, feed(4) -> BUY, feed(1) -> HOLD,
  // feed(0.5) -> SELL), but here the first three prices are restored directly instead of
  // fed tick by tick, simulating what a restart would restore from persistence.
  const engine = new StrategyEngine(new SmaCrossoverStrategy(2, 3), 10);
  engine.restoreHistory([3, 2, 1]);
  engine.start();
  const feed = (price, timestamp) => engine.onTick({ market: "KRW-BTC", price, timestamp }, 0);
  // Without a full re-warm-up (no more "warming-up" HOLDs needed), but SmaCrossoverStrategy's
  // own previousSpread is not restored, so this first tick only re-establishes it (HOLD)
  // instead of immediately detecting the BUY the original unbroken sequence found here.
  const firstAfterRestore = feed(4, 1);
  assert.equal(firstAfterRestore.type, "HOLD");
  assert.equal(firstAfterRestore.reason, "baseline-established");
  // From here on, values are numerically identical to the unbroken sequence one step later:
  // HOLD "no-cross", then the real SELL crossover -- proving continuity resumed correctly.
  assert.equal(feed(1, 2).type, "HOLD");
  assert.equal(feed(0.5, 3).type, "SELL");
  assert.deepEqual(engine.getHistory(), [3, 2, 1, 4, 1, 0.5]);
});

test("DesktopPersistenceStore persists and restores strategy price history independently of paper/control state", () => {
  const filename = dbPath();
  const first = new DesktopPersistenceStore(filename);
  assert.equal(first.loadStrategyPriceHistory(), undefined);
  first.saveStrategyPriceHistory([100, 101, 102.5]);
  assert.deepEqual(first.loadStrategyPriceHistory(), [100, 101, 102.5]);
  first.close();

  const second = new DesktopPersistenceStore(filename);
  assert.deepEqual(second.loadStrategyPriceHistory(), [100, 101, 102.5]);
  // Unrelated to the paper/control save cycle: never written, so still absent.
  assert.equal(second.load(), undefined);
  second.close();
});

test("saveStrategyPriceHistory overwrites the prior snapshot and rejects invalid prices", () => {
  const store = new DesktopPersistenceStore(dbPath());
  store.saveStrategyPriceHistory([1, 2, 3]);
  store.saveStrategyPriceHistory([4, 5]);
  assert.deepEqual(store.loadStrategyPriceHistory(), [4, 5]);
  assert.throws(() => store.saveStrategyPriceHistory([1, -1]), /positive finite/);
  store.close();
});
