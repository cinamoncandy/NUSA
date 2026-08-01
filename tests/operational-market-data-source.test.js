const test = require("node:test");
const assert = require("node:assert/strict");
const { UpbitMinuteCandleSource, UpbitMinuteCandleSourceError } = require("../dist/apps/desktop/src/upbitMinuteCandleSource.js");

const row = (time, changes = {}) => ({ market: "KRW-BTC", candle_date_time_utc: new Date(time).toISOString(), opening_price: 100, high_price: 110, low_price: 90, trade_price: 105, candle_acc_trade_volume: 1, ...changes });

test("official newest-first minute candles are normalized and open candle is excluded", async () => {
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => [row(180_000), row(120_000), row(60_000), row(0)], () => 180_000);
  const candles = await source.loadClosedCandles();
  assert.deepEqual(candles.map((candle) => candle.openTime), [0, 60_000, 120_000]);
  assert.equal(candles[0].sourceType, "UPBIT_PUBLIC_CANDLE");
  assert.equal(candles[0].qualityStatus, "VALID");
});

test("gaps, mixed ordering, and invalid OHLC fail closed", async () => {
  const gap = new UpbitMinuteCandleSource("KRW-BTC", async () => [row(120_000), row(0)], () => 180_000);
  await assert.rejects(gap.loadClosedCandles(), (error) => error.code === "GAP_DETECTED");
  const mixed = new UpbitMinuteCandleSource("KRW-BTC", async () => [row(120_000), row(0), row(60_000)], () => 180_000);
  await assert.rejects(mixed.loadClosedCandles(), (error) => error.code === "OUT_OF_ORDER");
  const invalid = new UpbitMinuteCandleSource("KRW-BTC", async () => [row(0, { low_price: 120 })], () => 180_000);
  await assert.rejects(invalid.loadClosedCandles(), (error) => error instanceof UpbitMinuteCandleSourceError && error.code === "INVALID_RESPONSE");
});

test("public candle requests retry bounded transient failures with exponential backoff", async () => {
  let calls = 0;
  const sleeps = [];
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => {
    calls += 1;
    if (calls < 3) throw new Error("HTTP 503");
    return [row(0)];
  }, () => 60_000, { baseDelayMs: 10, maxDelayMs: 20, minimumIntervalMs: 0, sleep: async (ms) => sleeps.push(ms) });
  const candles = await source.loadClosedCandles(1);
  assert.equal(candles.length, 1);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("public candle retries stop at the configured attempt limit", async () => {
  let calls = 0;
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => { calls += 1; throw new Error("HTTP 503"); }, () => 60_000, { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, minimumIntervalMs: 0, sleep: async () => undefined });
  await assert.rejects(source.loadClosedCandles(1), /HTTP 503/);
  assert.equal(calls, 2);
});
