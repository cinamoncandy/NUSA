"use strict";

// Incremental ledger projection (O(n) total) must be exactly equivalent to
// full replay. Differential design: the same events run through the live
// incremental path, then through a poisoned restore (full-replay path) —
// both must converge bit-for-bit. Plus a scale bound proving the quadratic
// curve is gone.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUANTITIES = [0.001, 0.01, 0.1, 1.5, 100, 0.00000001];
const PRICES = [0.5, 0.01, 1.99, 50000, 999999999.99, 123456789.12345679];

function runSequence(seed, fills) {
  const rand = mulberry32(seed);
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0.0005);
  let executed = 0;
  let skipped = 0;
  for (let i = 0; i < fills; i++) {
    const side = rand() < 0.55 ? "BUY" : "SELL";
    const quantity = QUANTITIES[Math.floor(rand() * QUANTITIES.length)];
    const price = PRICES[Math.floor(rand() * PRICES.length)];
    try {
      broker.execute(side, quantity, price, new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 60), i % 60)));
      executed += 1;
    } catch (error) {
      assert.match(error.message, /insufficient paper position|insufficient paper cash|quantity is below market step|notional is below minimum/);
      skipped += 1;
    }
  }
  return { broker, executed, skipped };
}

function stateOf(broker) {
  const state = broker.exportState();
  return {
    cash: state.cash,
    position: { ...state.position },
    orders: state.orders.length,
    ledger: state.ledger.length,
  };
}

test("incremental projection matches poisoned full-replay restore", () => {
  for (const seed of [7, 42, 1337]) {
    const { broker, executed } = runSequence(seed, 120);
    assert.ok(executed > 40, "sequence must contain real fills");
    const live = stateOf(broker);
    const revived = new PaperBroker(1_000_000_000, "KRW-BTC", 0.0005);
    // Poison snapshot fields: restore must re-derive everything from the ledger.
    revived.restoreState({
      ...broker.exportState(),
      cash: 1,
      position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 },
    });
    assert.deepEqual(stateOf(revived), live);
  }
});

test("3000 mixed fills complete far below the old quadratic curve", () => {
  const started = Date.now();
  const { broker, executed } = runSequence(99, 3000);
  const elapsed = Date.now() - started;
  assert.ok(executed > 1000, "sequence must contain real fills");
  assert.ok(elapsed < 5000, `3000 fills took ${elapsed}ms (old curve: ~11000ms)`);
  assert.equal(broker.exportState().ledger.length, executed);
});

test("close-reopen cycles keep exact accounting across restore", () => {
  const broker = new PaperBroker(1_000_000, "KRW-BTC", 0.001);
  const t = (s) => new Date(`2026-01-01T00:00:${String(s).padStart(2, "0")}Z`);
  broker.execute("BUY", 1, 50000, t(1));
  broker.execute("SELL", 1, 51000, t(2));
  broker.execute("BUY", 0.5, 49000, t(3));
  broker.execute("SELL", 0.5, 52000, t(4));
  const before = stateOf(broker);
  assert.equal(before.position.quantity, 0);
  const revived = new PaperBroker(1_000_000, "KRW-BTC", 0.001);
  revived.restoreState({ ...broker.exportState(), cash: 2, position: { market: "KRW-BTC", quantity: 9, averagePrice: 9, realizedPnl: 9 } });
  assert.deepEqual(stateOf(revived), before);
});
