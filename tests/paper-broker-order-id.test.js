"use strict";

// P1 item 4 (PaperBroker ID uniqueness): pin the contract that order IDs and
// derived fill IDs can never collide or be reused — same-millisecond bursts,
// injected/frozen clocks (backtest/replay), and export/restore cycles.
// Production code path: packages/core/src/paperBroker.ts (re-exported by the
// desktop broker). No production change; this test is the evidence.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

const FROZEN_NOW = new Date("2026-01-01T00:00:00.000Z");

function buy(broker, qty = 0.001) {
  return broker.execute("BUY", qty, 50_000_000, new Date(FROZEN_NOW.getTime()));
}

test("same-millisecond orders receive unique order and fill IDs", () => {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0.001);
  const ids = new Set();
  const fillIds = new Set();
  for (let i = 0; i < 25; i++) {
    const order = buy(broker);
    assert.ok(!ids.has(order.id), `order id reused: ${order.id}`);
    ids.add(order.id);
    const fillId = `fill:${order.id}`;
    assert.ok(!fillIds.has(fillId), `fill id reused: ${fillId}`);
    fillIds.add(fillId);
  }
  assert.equal(ids.size, 25);
});

test("order IDs stay unique across export/restore (restart continuity)", () => {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0.001);
  const before = [];
  for (let i = 0; i < 10; i++) before.push(buy(broker).id);
  const restored = new PaperBroker(1_000_000_000, "KRW-BTC", 0.001);
  restored.restoreState(broker.exportState());
  const after = [];
  for (let i = 0; i < 10; i++) after.push(buy(restored).id);
  const all = new Set([...before, ...after]);
  assert.equal(all.size, 20);
});

test("ledger fill IDs never repeat, including after restore", () => {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0.001);
  for (let i = 0; i < 5; i++) buy(broker);
  const restored = new PaperBroker(1_000_000_000, "KRW-BTC", 0.001);
  restored.restoreState(broker.exportState());
  for (let i = 0; i < 5; i++) buy(restored);
  const fillIds = restored.exportState().ledger.map((entry) => entry.fillId);
  assert.equal(fillIds.length, 10);
  assert.equal(new Set(fillIds).size, 10);
});
