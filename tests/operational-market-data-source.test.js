const test = require("node:test");
const assert = require("node:assert/strict");
const { UpbitMinuteCandleSource, UpbitMinuteCandleSourceError } = require("../dist/apps/desktop/src/upbitMinuteCandleSource.js");

const base = (openTime, overrides = {}) => ({
  market: "KRW-BTC",
  candle_date_time_utc: new Date(openTime).toISOString().replace(".000Z", "Z"),
  opening_price: 100,
  high_price: 110,
  low_price: 90,
  trade_price: 105,
  candle_acc_trade_volume: 1,
  ...overrides
});

test("official minute candle source excludes the open candle and preserves source semantics", async () => {
  const now = 1_700_000_180_000;
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => [base(1_700_000_060_000), base(1_700_000_120_000), base(1_700_000_180_000)], () => now);
  const candles = await source.loadClosedCandles();
  assert.equal(candles.length, 2);
  assert.equal(candles[0].sourceType, "UPBIT_PUBLIC_CANDLE");
  assert.equal(candles[0].sourceEventCount, 1);
  assert.equal(candles[0].qualityStatus, "VALID");
  assert.equal(candles.some((candle) => candle.incomplete), false);
});

test("missing intervals fail closed and are never synthesized", async () => {
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => [base(1_700_000_000_000), base(1_700_000_120_000)], () => 1_700_000_180_000);
  await assert.rejects(source.loadClosedCandles(), (error) => error instanceof UpbitMinuteCandleSourceError && error.code === "GAP_DETECTED");
});

test("out-of-order source responses fail closed", async () => {
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => [base(1_700_000_120_000), base(1_700_000_000_000), base(1_700_000_060_000)], () => 1_700_000_180_000);
  await assert.rejects(source.loadClosedCandles(), (error) => error instanceof UpbitMinuteCandleSourceError && error.code === "OUT_OF_ORDER");
});

test("official newest-first responses are normalized deterministically", async () => {
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => [base(1_700_000_120_000), base(1_700_000_060_000), base(1_700_000_000_000)], () => 1_700_000_180_000);
  const candles = await source.loadClosedCandles();
  assert.deepEqual(candles.map((candle) => candle.openTime), [1_700_000_000_000, 1_700_000_060_000, 1_700_000_120_000]);
});

test("invalid OHLC data is rejected", async () => {
  const source = new UpbitMinuteCandleSource("KRW-BTC", async () => [base(1_700_000_000_000, { low_price: 120 })], () => 1_700_000_180_000);
  await assert.rejects(source.loadClosedCandles(), (error) => error.code === "INVALID_RESPONSE");
});
