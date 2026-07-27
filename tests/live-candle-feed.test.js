const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapUpbitMinuteCandlesToChartCandles,
  LiveCandleFeed,
  fetchRecentMinuteCandles
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

function pageOfCandles(count, endTime) {
  return Array.from({ length: count }, (_, i) =>
    rawCandle({ candle_date_time_utc: new Date(endTime - i * 60_000).toISOString().slice(0, 19) })
  );
}

test("fetchRecentMinuteCandles makes a single request (no `to` cursor) when count is within Upbit's 200 per-page cap", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => pageOfCandles(150, Date.parse("2026-07-24T00:00:00Z")) };
  };
  try {
    const candles = await fetchRecentMinuteCandles("KRW-BTC", 1, 150);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("count=150"));
    assert.ok(!calls[0].includes("&to="));
    assert.equal(candles.length, 150);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRecentMinuteCandles pages backward via the `to` cursor when count exceeds 200", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const endTime = Date.parse("2026-07-24T12:00:00Z");
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) return { ok: true, json: async () => pageOfCandles(200, endTime) };
    if (calls.length === 2) return { ok: true, json: async () => pageOfCandles(200, endTime - 200 * 60_000) };
    return { ok: true, json: async () => pageOfCandles(50, endTime - 400 * 60_000) };
  };
  try {
    const candles = await fetchRecentMinuteCandles("KRW-BTC", 1, 450);
    assert.equal(calls.length, 3, "450 candles at 200/page needs 3 requests");
    assert.ok(!calls[0].includes("&to="), "first page has no cursor");
    assert.ok(calls[1].includes("&to="), "later pages page backward via `to`");
    assert.ok(calls[2].includes("&to="));
    assert.equal(candles.length, 450);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRecentMinuteCandles stops early once Upbit runs out of history (a page returns fewer than requested)", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const endTime = Date.parse("2026-07-24T12:00:00Z");
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => pageOfCandles(200, endTime) };
    return { ok: true, json: async () => pageOfCandles(30, endTime - 200 * 60_000) };
  };
  try {
    const candles = await fetchRecentMinuteCandles("KRW-BTC", 1, 1000);
    assert.equal(calls, 2, "must not keep requesting once a short page signals end of history");
    assert.equal(candles.length, 230);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRecentMinuteCandles never exceeds its hard page-count safety cap, even for a huge requested count", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => pageOfCandles(200, Date.parse("2026-07-24T12:00:00Z") - (calls - 1) * 200 * 60_000) };
  };
  try {
    const candles = await fetchRecentMinuteCandles("KRW-BTC", 1, 100_000);
    assert.equal(calls, 10, "must cap at MAX_MINUTE_CANDLE_PAGES requests regardless of requested count");
    assert.equal(candles.length, 2000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
