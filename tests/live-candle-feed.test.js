const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapUpbitMinuteCandlesToChartCandles,
  LiveCandleFeed
} = require("../dist/apps/server/src/liveCandleFeed.js");

function rawCandle(overrides = {}) {
  return {
    market: "KRW-BTC",
    candle_date_time_utc: "2026-07-24T00:01:00",
    opening_price: 100_000_000,
    high_price: 101_000_000,
    low_price: 99_000_000,
    trade_price: 100_500_000,
    candle_acc_trade_volume: 1.25,
    unit: 1,
    ...overrides
  };
}

test("mapUpbitMinuteCandlesToChartCandles sorts ascending and computes closeTime from unitMinutes", () => {
  const raw = [
    rawCandle({ candle_date_time_utc: "2026-07-24T00:02:00" }),
    rawCandle({ candle_date_time_utc: "2026-07-24T00:01:00" })
  ];
  const candles = mapUpbitMinuteCandlesToChartCandles(raw, 1);
  assert.equal(candles.length, 2);
  assert.ok(candles[0].openTime < candles[1].openTime);
  assert.equal(candles[0].closeTime - candles[0].openTime, 60_000);
  assert.equal(candles[0].unitMinutes, 1);
});

test("mapUpbitMinuteCandlesToChartCandles rejects empty response and invalid numeric fields", () => {
  assert.throws(() => mapUpbitMinuteCandlesToChartCandles([], 1), /empty/);
  assert.throws(() => mapUpbitMinuteCandlesToChartCandles([rawCandle({ trade_price: 0 })], 1), /trade_price/);
  assert.throws(() => mapUpbitMinuteCandlesToChartCandles([rawCandle({ candle_acc_trade_volume: -1 })], 1), /candle_acc_trade_volume/);
  assert.throws(() => mapUpbitMinuteCandlesToChartCandles([rawCandle()], 0), /unitMinutes/);
});

test("LiveCandleFeed.pollOnce updates candles and health on success, using an injected fetcher (no real network)", async () => {
  let calls = 0;
  const fakeFetcher = async (market, unit, count) => {
    calls += 1;
    assert.equal(market, "KRW-BTC");
    assert.equal(unit, 1);
    assert.equal(count, 5);
    return [rawCandle()];
  };
  const updates = [];
  const feed = new LiveCandleFeed("KRW-BTC", 1, 5, (candles) => updates.push(candles), 10_000, fakeFetcher);
  await feed.pollOnce();
  assert.equal(calls, 1);
  assert.equal(updates.length, 1);
  assert.equal(feed.latestCandles().length, 1);
  assert.equal(feed.health().status, "CONNECTED");
  assert.ok(feed.health().lastUpdatedAt !== undefined);
});

test("LiveCandleFeed.pollOnce reports ERROR on failure but keeps previously fetched candles", async () => {
  let shouldFail = false;
  const fetcher = async () => {
    if (shouldFail) throw new Error("network down");
    return [rawCandle()];
  };
  const updates = [];
  const feed = new LiveCandleFeed("KRW-BTC", 1, 5, (candles) => updates.push(candles), 10_000, fetcher);
  await feed.pollOnce();
  assert.equal(feed.health().status, "CONNECTED");
  shouldFail = true;
  await feed.pollOnce();
  assert.equal(feed.health().status, "ERROR");
  assert.equal(feed.health().lastError, "network down");
  assert.equal(updates.length, 1, "onUpdate must not be called again on a failed poll");
  assert.equal(feed.latestCandles().length, 1, "previously fetched candles must be retained on failure");
});

test("start()/stop() manage the interval without leaking or double-starting", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return [rawCandle()]; };
  const feed = new LiveCandleFeed("KRW-BTC", 1, 5, () => {}, 5, fetcher);
  feed.start();
  feed.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  feed.stop();
  const callsAtStop = calls;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, callsAtStop, "no further polling after stop()");
  assert.ok(callsAtStop >= 1);
});
