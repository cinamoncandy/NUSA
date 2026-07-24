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
