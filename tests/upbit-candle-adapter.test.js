const test = require("node:test");
const assert = require("node:assert/strict");
const { mapUpbitDayCandlesToResearchCandles } = require("../dist/apps/desktop/src/exchange/upbitCandleAdapter.js");
const { validateResearchCandles, createHistoricalDatasetManifest } = require("../dist/apps/desktop/src/cloud/researchDataset.js");

// Shaped like real responses from Upbit's public GET /v1/candles/days -- most recent first,
// exactly as the live API returns them. No network call in this test.
const rawDescending = [
  { market: "KRW-BTC", candle_date_time_utc: "2026-01-03T00:00:00", opening_price: 102_000_000, high_price: 103_500_000, low_price: 101_000_000, trade_price: 103_000_000, candle_acc_trade_volume: 120.5 },
  { market: "KRW-BTC", candle_date_time_utc: "2026-01-02T00:00:00", opening_price: 100_500_000, high_price: 102_500_000, low_price: 99_800_000, trade_price: 102_000_000, candle_acc_trade_volume: 98.25 },
  { market: "KRW-BTC", candle_date_time_utc: "2026-01-01T00:00:00", opening_price: 100_000_000, high_price: 101_000_000, low_price: 99_000_000, trade_price: 100_500_000, candle_acc_trade_volume: 87.1 }
];

test("maps Upbit's descending public candle response to ascending ResearchCandle records", () => {
  const candles = mapUpbitDayCandlesToResearchCandles(rawDescending);
  assert.equal(candles.length, 3);
  assert.ok(candles[0].openTime < candles[1].openTime);
  assert.ok(candles[1].openTime < candles[2].openTime);
  assert.equal(candles[0].close, 100_500_000);
  assert.equal(candles[2].close, 103_000_000);
  assert.equal(candles[0].interval, "1d");
  assert.equal(candles[0].closeTime - candles[0].openTime, 86_400_000);
  assert.equal(candles[0].market, "KRW-BTC");
});

test("mapped candles pass the research dataset's own validation and manifest checksum", () => {
  const candles = mapUpbitDayCandlesToResearchCandles(rawDescending);
  const validated = validateResearchCandles(candles);
  assert.equal(validated.continuityStatus, "CONTIGUOUS");
  assert.equal(validated.missingCandleCount, 0);

  const manifest = createHistoricalDatasetManifest(candles, { source: "upbit-public-api", createdAt: "2026-01-04T00:00:00.000Z" });
  assert.equal(manifest.market, "KRW-BTC");
  assert.equal(manifest.interval, "1d");
  assert.equal(manifest.candleCount, 3);
  assert.equal(manifest.missingCandleCount, 0);
});

test("rejects an empty response and non-finite prices", () => {
  assert.throws(() => mapUpbitDayCandlesToResearchCandles([]), /empty/);
  assert.throws(() => mapUpbitDayCandlesToResearchCandles([{ ...rawDescending[0], trade_price: -1 }]), /trade_price/);
  assert.throws(() => mapUpbitDayCandlesToResearchCandles([{ ...rawDescending[0], candle_date_time_utc: "not-a-date" }]), /candle_date_time_utc/);
});

test("detects a missing day the same way the real dataset validator does", () => {
  const withGap = [rawDescending[0], rawDescending[2]]; // skips 2026-01-02
  const candles = mapUpbitDayCandlesToResearchCandles(withGap);
  assert.throws(() => validateResearchCandles(candles), /missing candle intervals/);
  const allowed = validateResearchCandles(candles, { allowMissing: true });
  assert.equal(allowed.continuityStatus, "MISSING_INTERVALS");
  assert.equal(allowed.missingCandleCount, 1);
});
