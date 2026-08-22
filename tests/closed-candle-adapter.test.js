const test = require("node:test");
const assert = require("node:assert/strict");
const { createClosedCandleAdapter } = require("../dist/apps/desktop/src/strategy/closedCandleAdapter.js");

const tick = (overrides = {}) => ({
  code: "KRW-BTC",
  trade_price: 100,
  trade_timestamp: 1_000,
  ...overrides
});

test("aggregates a UTC minute, sums known volume, and emits only after the next bucket", () => {
  const adapter = createClosedCandleAdapter({ symbol: "KRW-BTC" });
  const first = Object.freeze(tick({ trade_volume: 1, trade_id: "one" }));
  assert.equal(adapter.ingestTicker(first).emittedCandles.length, 0);
  adapter.ingestTicker(tick({ trade_price: 120, trade_timestamp: 2_000, trade_volume: 2, trade_id: "two" }));
  adapter.ingestTicker(tick({ trade_price: 90, trade_timestamp: 3_000, trade_volume: 3, trade_id: "three" }));
  const result = adapter.ingestTicker(tick({ trade_price: 110, trade_timestamp: 60_000, trade_id: "next" }));

  assert.deepEqual(result.emittedCandles, [{
    symbol: "KRW-BTC", interval: "1m", openTime: 0, closeTime: 60_000,
    open: 100, high: 120, low: 90, close: 90, volume: 6, volumeAvailable: true,
    tradeCount: 3, closed: true, sequence: 1, source: "UPBIT_PUBLIC_TICKER"
  }]);
  assert.deepEqual(first, tick({ trade_volume: 1, trade_id: "one" }));
});

test("marks incomplete ticker volume as unavailable instead of estimating it", () => {
  const adapter = createClosedCandleAdapter({ symbol: "KRW-BTC" });
  adapter.ingestTicker(tick());
  adapter.ingestTicker(tick({ trade_timestamp: 2_000, trade_volume: 5 }));
  const candle = adapter.ingestTicker(tick({ trade_timestamp: 60_000 })).emittedCandles[0];
  assert.equal(candle.volume, 0);
  assert.equal(candle.volumeAvailable, false);
});

test("deduplicates tickers and rejects invalid, mismatched, and out-of-order input without mutation", () => {
  const adapter = createClosedCandleAdapter({ symbol: "KRW-BTC" });
  const first = tick({ trade_volume: 1, trade_id: "one" });
  adapter.ingestTicker(first);
  assert.equal(adapter.ingestTicker(first).healthEvents[0].code, "DUPLICATE_TICKER");
  assert.equal(adapter.ingestTicker(tick({ code: "KRW-ETH", trade_timestamp: 2_000 })).healthEvents[0].code, "SYMBOL_MISMATCH");
  for (const invalid of [
    tick({ trade_price: Number.NaN }), tick({ trade_price: Number.POSITIVE_INFINITY }),
    tick({ trade_timestamp: -1 }), tick({ trade_timestamp: 1.5 })
  ]) assert.equal(adapter.ingestTicker(invalid).healthEvents[0].code, "INVALID_TICKER");

  const emitted = adapter.ingestTicker(tick({ trade_price: 110, trade_timestamp: 60_000 })).emittedCandles[0];
  assert.equal(adapter.ingestTicker(tick({ trade_price: 5, trade_timestamp: 2_000 })).healthEvents[0].code, "OUT_OF_ORDER");
  assert.equal(emitted.close, 100);
  assert.equal(adapter.inspectState().closedCandleCount, 1);
});

test("uses deterministic sequences and never synthesizes gap candles", () => {
  const adapter = createClosedCandleAdapter({ symbol: "KRW-BTC" });
  adapter.ingestTicker(tick({ trade_id: "one" }));
  const gap = adapter.ingestTicker(tick({ trade_price: 101, trade_timestamp: 180_000, trade_id: "two" }));
  assert.equal(gap.emittedCandles.length, 1);
  assert.equal(gap.emittedCandles[0].sequence, 1);
  assert.deepEqual(gap.healthEvents, [{ code: "GAP_DETECTED", timestamp: 180_000, missingIntervals: 2 }]);
  const next = adapter.ingestTicker(tick({ trade_price: 102, trade_timestamp: 240_000, trade_id: "three" }));
  assert.equal(next.emittedCandles[0].sequence, 2);
  assert.equal(JSON.stringify(next.emittedCandles[0]), JSON.stringify({ ...next.emittedCandles[0] }));
});

test("does not force-close on disconnect and handles same-bucket and later-bucket reconnects", () => {
  const sameBucket = createClosedCandleAdapter({ symbol: "KRW-BTC" });
  sameBucket.ingestTicker(tick({ trade_id: "one" }));
  sameBucket.markDisconnected(2_000);
  assert.equal(sameBucket.ingestTicker(tick({ trade_timestamp: 3_000 })).emittedCandles.length, 0);
  sameBucket.markReconnected(4_000);
  assert.equal(sameBucket.ingestTicker(tick({ trade_price: 105, trade_timestamp: 5_000, trade_id: "two" })).emittedCandles.length, 0);

  const laterBucket = createClosedCandleAdapter({ symbol: "KRW-BTC" });
  laterBucket.ingestTicker(tick({ trade_id: "one" }));
  laterBucket.markDisconnected();
  laterBucket.markReconnected();
  const result = laterBucket.ingestTicker(tick({ trade_timestamp: 180_000, trade_id: "two" }));
  assert.equal(result.emittedCandles.length, 1);
  assert.equal(result.healthEvents[0].code, "GAP_DETECTED");
});

test("warm-up counts closed candles rather than ticker count", () => {
  const adapter = createClosedCandleAdapter({ symbol: "KRW-BTC", requiredWarmupCandles: 20 });
  for (let index = 0; index < 20; index += 1) {
    adapter.ingestTicker(tick({ trade_timestamp: index * 1_000, trade_price: 100 + index, trade_id: `intra-${index}` }));
  }
  assert.equal(adapter.inspectState().warmupComplete, false);
  for (let index = 1; index <= 20; index += 1) {
    adapter.ingestTicker(tick({ trade_timestamp: index * 60_000, trade_price: 200 + index, trade_id: `bucket-${index}` }));
  }
  assert.deepEqual(adapter.inspectState(), {
    connected: true, currentBucket: 1_200_000, closedCandleCount: 20,
    requiredWarmupCandles: 20, warmupComplete: true
  });
  adapter.resetWarmup();
  assert.equal(adapter.inspectState().warmupComplete, false);
});
