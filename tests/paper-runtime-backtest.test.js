const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { PaperRuntime } = require("../dist/apps/server/src/paperRuntime.js");

function fakeCandle(overrides = {}) {
  return {
    market: "KRW-BTC",
    candle_date_time_utc: "2026-07-24T00:01:00",
    opening_price: 100_000_000,
    high_price: 100_100_000,
    low_price: 99_900_000,
    trade_price: 100_000_000,
    candle_acc_trade_volume: 1,
    unit: 1,
    ...overrides
  };
}

// Upbit returns most-recent-first; timestamps must be distinct and parse via
// `${candle_date_time_utc}Z` (see liveCandleFeed.ts's own convention).
function historyOldestToNewest(prices) {
  return prices.map((price, index) => fakeCandle({
    candle_date_time_utc: `2026-07-24T00:${String(index).padStart(2, "0")}:00`,
    trade_price: price,
    opening_price: price
  })).reverse();
}

// Day candles have no `unit` field (see liveCandleFeed.ts's UpbitCandle vs UpbitMinuteCandle).
function dayCandle(overrides = {}) {
  const { unit, ...rest } = fakeCandle(overrides);
  return rest;
}

function dayHistoryOldestToNewest(prices) {
  return prices.map((price, index) => dayCandle({
    candle_date_time_utc: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00`,
    trade_price: price,
    opening_price: price
  })).reverse();
}

test("runBacktestComparison() returns one result per champion preset using real historical candles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-backtest-"));
  const databasePath = join(dir, "test.db");
  try {
    const flat = Array.from({ length: 20 }, () => 100_000_000);
    const rising = [110_000_000, 115_000_000, 120_000_000, 125_000_000, 130_000_000];
    const falling = [125_000_000, 120_000_000, 110_000_000, 100_000_000, 90_000_000];
    const candles = historyOldestToNewest([...flat, ...rising, ...falling]);

    const runtime = new PaperRuntime({
      databasePath,
      pollIntervalMs: 60_000,
      candleFetcher: async () => candles
    });
    try {
      const results = await runtime.runBacktestComparison();
      assert.equal(results.length, 3);
      assert.deepEqual(results.map((r) => r.id).sort(), ["ema-5-20", "sma-10-30", "sma-5-20"]);

      const sma5x20 = results.find((r) => r.id === "sma-5-20");
      assert.equal(sma5x20.metrics.initialEquity, 10_000_000);
      // A real flat-then-rise-then-fall series should produce at least one real BUY/SELL
      // fill for the fast SMA(5,20) preset -- this is genuine backtestEngine output, not a
      // fabricated number.
      assert.ok(sma5x20.metrics.fillCount > 0, "expected at least one real fill from the crossover");
    } finally {
      runtime.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBacktestComparison(\"day\") uses the day-candle fetcher, not the minute-candle one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-backtest-"));
  const databasePath = join(dir, "test.db");
  try {
    const flat = Array.from({ length: 20 }, () => 100_000_000);
    const rising = [110_000_000, 115_000_000, 120_000_000, 125_000_000, 130_000_000];
    const falling = [125_000_000, 120_000_000, 110_000_000, 100_000_000, 90_000_000];
    const dayCandles = dayHistoryOldestToNewest([...flat, ...rising, ...falling]);

    let minuteFetcherCalled = false;
    let dayFetcherRequestedCount;
    const runtime = new PaperRuntime({
      databasePath,
      pollIntervalMs: 60_000,
      candleFetcher: async () => { minuteFetcherCalled = true; return []; },
      dayCandleFetcher: async (market, count) => { dayFetcherRequestedCount = count; return dayCandles; }
    });
    try {
      const results = await runtime.runBacktestComparison("day");
      assert.equal(minuteFetcherCalled, false, "day backtest must not touch the minute candle fetcher");
      assert.equal(dayFetcherRequestedCount, 200);
      assert.equal(results.length, 3);
      const sma5x20 = results.find((r) => r.id === "sma-5-20");
      assert.equal(sma5x20.metrics.initialEquity, 10_000_000);
      assert.ok(sma5x20.metrics.fillCount > 0, "expected at least one real fill from the crossover");
    } finally {
      runtime.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBacktestComparison() defaults to the minute-candle fetcher when no unit is given", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-backtest-"));
  const databasePath = join(dir, "test.db");
  try {
    let minuteFetcherCalled = false;
    let dayFetcherCalled = false;
    const runtime = new PaperRuntime({
      databasePath,
      pollIntervalMs: 60_000,
      candleFetcher: async () => { minuteFetcherCalled = true; return historyOldestToNewest(Array.from({ length: 20 }, () => 100_000_000)); },
      dayCandleFetcher: async () => { dayFetcherCalled = true; return []; }
    });
    try {
      await runtime.runBacktestComparison();
      assert.equal(minuteFetcherCalled, true);
      assert.equal(dayFetcherCalled, false);
    } finally {
      runtime.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBacktestComparison() fetches at most 200 candles (Upbit's own per-request limit)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-backtest-"));
  const databasePath = join(dir, "test.db");
  try {
    let requestedCount;
    const runtime = new PaperRuntime({
      databasePath,
      pollIntervalMs: 60_000,
      candleFetcher: async (market, unitMinutes, count) => {
        requestedCount = count;
        return historyOldestToNewest(Array.from({ length: 20 }, () => 100_000_000));
      }
    });
    try {
      await runtime.runBacktestComparison();
      assert.equal(requestedCount, 200);
    } finally {
      runtime.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
