import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateUpbitDailyCandleFreshness,
  mapUpbitDayCandlesToResearchCandles,
  type UpbitDayCandle,
} from "./upbitCandleAdapter";

function candle(utc: string, close: number): UpbitDayCandle {
  return {
    market: "KRW-BTC",
    candle_date_time_utc: utc,
    opening_price: close,
    high_price: close + 1,
    low_price: close - 1,
    trade_price: close,
    candle_acc_trade_volume: 1,
  };
}

test("completedBy excludes an in-progress Upbit daily candle before research use", () => {
  const completedBy = Date.parse("2026-08-26T12:00:00Z");
  const result = mapUpbitDayCandlesToResearchCandles([
    candle("2026-08-26T00:00:00", 120),
    candle("2026-08-25T00:00:00", 110),
  ], { completedBy });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.openTime, Date.parse("2026-08-25T00:00:00Z"));
  assert.ok((result[0]?.closeTime ?? Infinity) <= completedBy);
});

test("daily candle is admitted exactly when its full UTC day has closed", () => {
  const closeTime = Date.parse("2026-08-27T00:00:00Z");
  const result = mapUpbitDayCandlesToResearchCandles([
    candle("2026-08-26T00:00:00", 120),
  ], { completedBy: closeTime });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.closeTime, closeTime);
});

test("maxCount keeps the most recent completed candles after point-in-time filtering", () => {
  const result = mapUpbitDayCandlesToResearchCandles([
    candle("2026-08-27T00:00:00", 130),
    candle("2026-08-26T00:00:00", 120),
    candle("2026-08-25T00:00:00", 110),
    candle("2026-08-24T00:00:00", 100),
  ], { completedBy: Date.parse("2026-08-27T12:00:00Z"), maxCount: 2 });

  assert.deepEqual(
    result.map((entry) => entry.openTime),
    [Date.parse("2026-08-25T00:00:00Z"), Date.parse("2026-08-26T00:00:00Z")],
  );
});

test("freshness aligns to the latest fully closed UTC daily interval", () => {
  const asOf = Date.parse("2026-08-27T12:41:00Z");
  const candles = mapUpbitDayCandlesToResearchCandles([
    candle("2026-08-26T00:00:00", 120),
    candle("2026-08-25T00:00:00", 110),
  ], { completedBy: asOf });
  const freshness = evaluateUpbitDailyCandleFreshness(candles, asOf);
  assert.equal(freshness.expectedLatestCloseTime, Date.parse("2026-08-27T00:00:00Z"));
  assert.equal(freshness.actualLatestCloseTime, Date.parse("2026-08-27T00:00:00Z"));
  assert.equal(freshness.lagDays, 0);
  assert.equal(freshness.fresh, true);
});

test("freshness exposes whole-day source lag without inventing a tolerance", () => {
  const asOf = Date.parse("2026-08-27T12:41:00Z");
  const candles = mapUpbitDayCandlesToResearchCandles([
    candle("2026-08-25T00:00:00", 110),
  ], { completedBy: asOf });
  const freshness = evaluateUpbitDailyCandleFreshness(candles, asOf);
  assert.equal(freshness.lagDays, 1);
  assert.equal(freshness.fresh, false);
});

test("completedBy fails closed when no historical daily candle is complete", () => {
  assert.throws(
    () => mapUpbitDayCandlesToResearchCandles([
      candle("2026-08-26T00:00:00", 120),
    ], { completedBy: Date.parse("2026-08-26T12:00:00Z") }),
    /no completed daily candles/,
  );
});

test("point-in-time options reject invalid boundaries", () => {
  assert.throws(
    () => mapUpbitDayCandlesToResearchCandles([
      candle("2026-08-25T00:00:00", 110),
    ], { completedBy: Number.NaN }),
    /completedBy must be finite/,
  );
  assert.throws(
    () => mapUpbitDayCandlesToResearchCandles([
      candle("2026-08-25T00:00:00", 110),
    ], { maxCount: 0 }),
    /maxCount must be a positive integer/,
  );
  assert.throws(() => evaluateUpbitDailyCandleFreshness([], Number.NaN), /asOf must be finite/);
});
