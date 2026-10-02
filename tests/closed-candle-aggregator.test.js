const test = require("node:test");
const assert = require("node:assert/strict");

const { aggregateClosedCandles, candleChecksum, DEFAULT_CANDLE_INTERVAL_MS } = require("../dist/apps/cloud/src/closedCandleAggregator.js");

const M = DEFAULT_CANDLE_INTERVAL_MS;
const T0 = 10 * M; // a bucket boundary
const obs = (offsetMs, price) => ({ observedAt: T0 + offsetMs, price });

test("builds OHLC from ticks in order and keeps volume at 0", () => {
  const r = aggregateClosedCandles({ observations: [obs(1000, 100), obs(20_000, 110), obs(30_000, 95), obs(50_000, 105)], nowMs: T0 + 2 * M });
  assert.equal(r.candles.length, 1);
  assert.deepEqual({ ...r.candles[0] }, { timestamp: T0, open: 100, high: 110, low: 95, close: 105, volume: 0 });
  assert.equal(r.missingBuckets, 0);
  assert.equal(r.rejectedObservations, 0);
});

test("a bucket that has not ended yet is never returned as a candle", () => {
  const r = aggregateClosedCandles({ observations: [obs(1000, 100), obs(M + 1000, 101)], nowMs: T0 + M + 30_000 });
  assert.deepEqual(r.candles.map((c) => c.timestamp), [T0]);
  const exactEnd = aggregateClosedCandles({ observations: [obs(1000, 100)], nowMs: T0 + M });
  assert.equal(exactEnd.candles.length, 1);
  const justBefore = aggregateClosedCandles({ observations: [obs(1000, 100)], nowMs: T0 + M - 1 });
  assert.equal(justBefore.candles.length, 0);
});

test("gaps are counted and never filled", () => {
  const r = aggregateClosedCandles({ observations: [obs(1000, 100), obs(3 * M + 1000, 103), obs(4 * M + 1000, 104)], nowMs: T0 + 10 * M });
  assert.deepEqual(r.candles.map((c) => c.timestamp), [T0, T0 + 3 * M, T0 + 4 * M]);
  assert.equal(r.missingBuckets, 2);
});

test("invalid and out-of-order observations are skipped and counted, not repaired", () => {
  const r = aggregateClosedCandles({
    observations: [obs(1000, 100), obs(500, 99), { observedAt: T0 + 2000, price: 0 }, { observedAt: T0 + 3000, price: NaN }, { observedAt: 1.5, price: 5 }, { observedAt: 0, price: 5 }, obs(40_000, 102)],
    nowMs: T0 + 2 * M,
  });
  assert.equal(r.rejectedObservations, 5);
  assert.deepEqual({ ...r.candles[0] }, { timestamp: T0, open: 100, high: 102, low: 100, close: 102, volume: 0 });
});

test("same input gives the same checksum; any change to the data changes it", () => {
  const a = aggregateClosedCandles({ observations: [obs(1000, 100), obs(M + 1000, 101)], nowMs: T0 + 5 * M });
  const b = aggregateClosedCandles({ observations: [obs(1000, 100), obs(M + 1000, 101)], nowMs: T0 + 9 * M });
  const c = aggregateClosedCandles({ observations: [obs(1000, 100), obs(M + 1000, 102)], nowMs: T0 + 5 * M });
  assert.match(a.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(a.checksumSha256, b.checksumSha256);
  assert.notEqual(a.checksumSha256, c.checksumSha256);
  assert.equal(a.checksumSha256, candleChecksum(a.candles));
});

test("empty input and bad configuration", () => {
  const empty = aggregateClosedCandles({ observations: [], nowMs: T0 });
  assert.equal(empty.candles.length, 0);
  assert.equal(empty.missingBuckets, 0);
  assert.throws(() => aggregateClosedCandles({ observations: [], nowMs: 0 }));
  assert.throws(() => aggregateClosedCandles({ observations: [], nowMs: T0, intervalMs: 10 }));
  assert.throws(() => aggregateClosedCandles({ observations: [], nowMs: T0, intervalMs: 1.5 }));
});
