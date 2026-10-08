const test = require("node:test");
const assert = require("node:assert/strict");
const { AggregatedResearchCandleSource } = require("../dist/apps/cloud/src/researchCandleAggregation.js");

const M = 60_000;
const H = 60 * M;
function base(rows) {
  return {
    read: (_m, interval, from, to) => { assert.equal(interval, M); return rows.filter((r) => r.closeTimeMs >= from && r.closeTimeMs <= to); },
    latestCloseTime: () => rows.at(-1)?.closeTimeMs,
    earliestCloseTime: () => rows[0]?.closeTimeMs,
    count: () => rows.length,
  };
}
const minute = (close, price) => ({ closeTimeMs: close, open: price, high: price + 1, low: price - 1, close: price + 0.5 });

test("a complete hour of 1m candles becomes one OHLC bar closing on the hour", () => {
  const start = 10 * H;
  const rows = Array.from({ length: 120 }, (_, i) => minute(start + (i + 1) * M, 100 + i));
  const source = new AggregatedResearchCandleSource(base(rows), M);
  const bars = source.read("KRW-BTC", H, start, start + 2 * H);
  assert.deepEqual(bars.map((b) => b.closeTimeMs), [start + H, start + 2 * H]);
  assert.deepEqual({ ...bars[0] }, { closeTimeMs: start + H, open: 100, high: 160, low: 99, close: 159.5 });
  assert.equal(source.latestCloseTime("KRW-BTC", H), start + 2 * H);
  assert.equal(source.earliestCloseTime("KRW-BTC", H), start + H);
  assert.equal(source.count("KRW-BTC", H), 2);
});

test("a bar with a missing 1m candle is never synthesized", () => {
  const start = 10 * H;
  const rows = Array.from({ length: 120 }, (_, i) => minute(start + (i + 1) * M, 100 + i)).filter((_, i) => i !== 30);
  const bars = new AggregatedResearchCandleSource(base(rows), M).read("KRW-BTC", H, start, start + 2 * H);
  assert.deepEqual(bars.map((b) => b.closeTimeMs), [start + 2 * H]);
});

test("the base interval passes through and non-multiples fail closed", () => {
  const rows = [minute(M, 1), minute(2 * M, 2)];
  const source = new AggregatedResearchCandleSource(base(rows), M);
  assert.equal(source.read("KRW-BTC", M, 0, 3 * M).length, 2);
  assert.throws(() => source.read("KRW-BTC", 90_000, 0, 3 * M), /whole multiple/);
});
