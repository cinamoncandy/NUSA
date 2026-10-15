const test = require("node:test");
const assert = require("node:assert/strict");

const { aggregateClosedCandles, candleChecksum, DEFAULT_CANDLE_INTERVAL_MS } = require("../dist/apps/cloud/src/closedCandleAggregator.js");

const M = DEFAULT_CANDLE_INTERVAL_MS;
const T0 = 10 * M; // a bucket boundary
// Ticks that cover a bucket densely: offsets 1s, 20s, 40s, 59s (every gap <= 30s).
const dense = (bucket, [a, b, c, d]) => [[1_000, a], [20_000, b], [40_000, c], [59_000, d]].map(([off, price]) => ({ observedAt: T0 + bucket * M + off, price }));
const base = { coverageStartMs: T0, nowMs: T0 + 20 * M };

test("builds OHLC from ticks in order, stamps the candle at its CLOSE time and keeps volume at 0", () => {
  const r = aggregateClosedCandles({ ...base, observations: dense(0, [100, 110, 95, 105]) });
  assert.equal(r.candles.length, 1);
  assert.deepEqual({ ...r.candles[0] }, { timestamp: T0 + M, open: 100, high: 110, low: 95, close: 105, volume: 0 });
  assert.equal(r.missingBuckets, 0);
  assert.equal(r.incompleteBuckets, 0);
  assert.equal(r.rejectedObservations, 0);
});

test("a bucket that has not ended yet is never returned as a candle", () => {
  const obs = [...dense(0, [100, 101, 102, 103]), ...dense(1, [104, 105, 106, 107])];
  const midSecond = aggregateClosedCandles({ ...base, observations: obs, nowMs: T0 + M + 30_000 });
  assert.deepEqual(midSecond.candles.map((c) => c.timestamp), [T0 + M]);
  assert.equal(aggregateClosedCandles({ ...base, observations: dense(0, [1, 2, 3, 4]), nowMs: T0 + M }).candles.length, 1);
  assert.equal(aggregateClosedCandles({ ...base, observations: dense(0, [1, 2, 3, 4]), nowMs: T0 + M - 1 }).candles.length, 0);
});

test("wholly empty buckets are counted as gaps and never filled", () => {
  const obs = [...dense(0, [100, 100, 100, 100]), ...dense(3, [103, 103, 103, 103]), ...dense(4, [104, 104, 104, 104])];
  const r = aggregateClosedCandles({ ...base, observations: obs });
  assert.deepEqual(r.candles.map((c) => c.timestamp), [T0 + M, T0 + 4 * M, T0 + 5 * M]);
  assert.equal(r.missingBuckets, 2);
});

test("a window that starts mid-minute does not produce a truncated candle", () => {
  const obs = dense(0, [100, 110, 95, 105]);
  const r = aggregateClosedCandles({ observations: obs, nowMs: T0 + 5 * M, coverageStartMs: T0 + 30_000 });
  assert.equal(r.candles.length, 0);
  assert.equal(r.incompleteBuckets, 1);
});

test("a feed outage inside a minute drops that candle (internal gap, late first tick, early last tick)", () => {
  const outage = [{ observedAt: T0 + 1_000, price: 100 }, { observedAt: T0 + 59_000, price: 101 }]; // 58 s gap
  const lateStart = [{ observedAt: T0 + 40_000, price: 100 }, { observedAt: T0 + 59_000, price: 101 }]; // first tick 40 s in
  const earlyEnd = [{ observedAt: T0 + 1_000, price: 100 }, { observedAt: T0 + 20_000, price: 101 }]; // last tick 40 s before end
  for (const [name, observations] of Object.entries({ outage, lateStart, earlyEnd })) {
    const r = aggregateClosedCandles({ ...base, observations });
    assert.equal(r.candles.length, 0, name);
    assert.equal(r.incompleteBuckets, 1, name);
  }
  const ok = aggregateClosedCandles({ ...base, observations: dense(0, [1, 2, 3, 4]), maxInternalGapMs: 30_000 });
  assert.equal(ok.candles.length, 1);
});

test("invalid and out-of-order observations are skipped and counted, not repaired", () => {
  const bad = [{ observedAt: T0 + 500, price: 99 }, { observedAt: T0 + 2000, price: 0 }, { observedAt: T0 + 3000, price: NaN }, { observedAt: 1.5, price: 5 }, { observedAt: 0, price: 5 }];
  const r = aggregateClosedCandles({ ...base, observations: [dense(0, [100, 101, 102, 103])[0], ...bad, ...dense(0, [100, 101, 102, 103]).slice(1)] });
  assert.equal(r.rejectedObservations, 5);
  assert.equal(r.candles.length, 1);
  assert.equal(r.candles[0].open, 100);
});

test("same input gives the same checksum; any change to the data changes it", () => {
  const obs = (p) => [...dense(0, [100, 101, 102, 103]), ...dense(1, [p, 101, 102, 103])];
  const a = aggregateClosedCandles({ ...base, observations: obs(100) });
  const b = aggregateClosedCandles({ ...base, observations: obs(100), nowMs: T0 + 30 * M });
  const c = aggregateClosedCandles({ ...base, observations: obs(104) });
  assert.match(a.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(a.checksumSha256, b.checksumSha256);
  assert.notEqual(a.checksumSha256, c.checksumSha256);
  assert.equal(a.checksumSha256, candleChecksum(a.candles));
});

test("empty input and bad configuration fail closed", () => {
  const empty = aggregateClosedCandles({ ...base, observations: [] });
  assert.equal(empty.candles.length, 0);
  assert.equal(empty.missingBuckets, 0);
  assert.throws(() => aggregateClosedCandles({ ...base, observations: [], nowMs: 0 }));
  assert.throws(() => aggregateClosedCandles({ ...base, observations: [], intervalMs: 10 }));
  assert.throws(() => aggregateClosedCandles({ ...base, observations: [], intervalMs: 1.5 }));
  assert.throws(() => aggregateClosedCandles({ ...base, observations: [], coverageStartMs: 0 }));
  assert.throws(() => aggregateClosedCandles({ ...base, observations: [], coverageStartMs: NaN }));
  assert.throws(() => aggregateClosedCandles({ ...base, observations: [], maxInternalGapMs: 0 }));
  assert.throws(() => aggregateClosedCandles({ ...base, observations: [], maxInternalGapMs: M + 1 }));
});
