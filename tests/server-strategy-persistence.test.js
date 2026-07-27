const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { PaperRuntime } = require("../dist/apps/server/src/paperRuntime.js");

function fakeCandle() {
  return {
    market: "KRW-BTC",
    candle_date_time_utc: "2026-07-24T00:01:00",
    opening_price: 100_000_000,
    high_price: 100_100_000,
    low_price: 99_900_000,
    trade_price: 100_000_000,
    candle_acc_trade_volume: 1,
    unit: 1
  };
}

test("selected strategy (SMA/EMA) survives a full PaperRuntime restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-persist-"));
  const databasePath = join(dir, "test.db");
  try {
    const first = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.equal(first.getControlSnapshot().activeStrategyId, "sma-crossover", "default before any selection");
    first.selectStrategy("ema-crossover");
    assert.equal(first.getControlSnapshot().activeStrategyId, "ema-crossover");
    first.dispose();

    const second = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.equal(second.getControlSnapshot().activeStrategyId, "ema-crossover", "restored across restart");
    second.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fresh database (no prior selection) defaults to sma-crossover", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-persist-"));
  const databasePath = join(dir, "test.db");
  try {
    const runtime = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.equal(runtime.getControlSnapshot().activeStrategyId, "sma-crossover");
    runtime.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("position protection survives a full PaperRuntime restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-persist-"));
  const databasePath = join(dir, "test.db");
  try {
    const first = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.deepEqual(first.getPositionProtection(), {
      stopLossPrice: null, takeProfitPrice: null, trailingStopPercent: null, currentTrailingStopPrice: null
    }, "default before any setting");
    first.setPositionProtection({ stopLossPrice: 90_000_000, takeProfitPrice: 110_000_000, trailingStopPercent: null });
    first.dispose();

    const second = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.deepEqual(second.getPositionProtection(), {
      stopLossPrice: 90_000_000, takeProfitPrice: 110_000_000, trailingStopPercent: null, currentTrailingStopPrice: null
    }, "restored across restart");
    second.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("position sizing survives a full PaperRuntime restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-persist-"));
  const databasePath = join(dir, "test.db");
  try {
    const first = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.deepEqual(first.getPositionSizing(), { mode: "FIXED", riskFraction: 0.1 }, "default before any setting");
    first.setPositionSizing({ mode: "FIXED_FRACTIONAL", riskFraction: 0.3 });
    first.dispose();

    const second = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.deepEqual(second.getPositionSizing(), { mode: "FIXED_FRACTIONAL", riskFraction: 0.3 }, "restored across restart");
    second.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pending limit orders survive a full PaperRuntime restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-strategy-persist-"));
  const databasePath = join(dir, "test.db");
  try {
    const first = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.deepEqual(first.getLimitOrders(), [], "no pending orders by default");
    const created = first.createLimitOrder("BUY", 0.001, 90_000_000);
    first.dispose();

    const second = new PaperRuntime({ databasePath, pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle()] });
    assert.deepEqual(second.getLimitOrders(), [created], "restored across restart");
    // A fresh limitOrderSequence must not collide with the restored order's id on the next create.
    const another = second.createLimitOrder("SELL", 0.001, 120_000_000);
    assert.notEqual(another.id, created.id);
    second.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
