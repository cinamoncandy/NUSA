const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { collectClosedCandles } = require("../dist/apps/cloud/src/researchCandleCollector.js");
const { SqliteDatabase, SqliteResearchCandleStore, SqlitePaperMarketObservationRepository } = require("../dist/packages/storage/src/index.js");

const M = 60_000;
const T0 = 10 * M;
// Ticks that densely cover bucket `n` (offsets 1s, 20s, 40s, 59s).
const dense = (n, [a, b, c, d]) => [[1_000, a], [20_000, b], [40_000, c], [59_000, d]].map(([off, price]) => ({ observedAt: T0 + n * M + off, price }));

function fakes(observationsByMarket, latestByMarket = {}) {
  const appended = [];
  return {
    appended,
    observations: { readWindow: (market, start, end) => (observationsByMarket[market] ?? []).filter((o) => o.observedAt >= start && o.observedAt <= end) },
    sink: {
      latestCloseTime: (market) => latestByMarket[market],
      append: (market, interval, candles) => { appended.push({ market, interval, candles }); return candles.length; },
    },
  };
}

test("first pass skips the first (possibly truncated) bucket and stores later closed buckets", () => {
  const f = fakes({ "KRW-BTC": [...dense(0, [1, 2, 3, 4].map((x) => x + 99)), ...dense(1, [100, 110, 95, 105]), ...dense(2, [105, 106, 104, 105])] });
  const [r] = collectClosedCandles({ markets: ["KRW-BTC"], nowMs: T0 + 3 * M + 5_000, observations: f.observations, sink: f.sink });
  assert.equal(r.status, "COLLECTED");
  assert.equal(r.recorded, 2);
  assert.equal(r.incompleteBuckets, 1);
  assert.deepEqual(f.appended[0].candles.map((c) => c.closeTimeMs), [T0 + 2 * M, T0 + 3 * M]);
});

test("later passes resume exactly at the last stored close and never re-append older candles", () => {
  const obs = [...dense(1, [100, 110, 95, 105]), ...dense(2, [105, 106, 104, 105]), ...dense(3, [105, 107, 103, 106])];
  const f = fakes({ "KRW-BTC": obs }, { "KRW-BTC": T0 + 2 * M });
  const [r] = collectClosedCandles({ markets: ["KRW-BTC"], nowMs: T0 + 5 * M, observations: f.observations, sink: f.sink });
  assert.equal(r.recorded, 2);
  assert.deepEqual(f.appended[0].candles.map((c) => c.closeTimeMs), [T0 + 3 * M, T0 + 4 * M]);
});

test("when retained observations no longer reach back to the resume point, the oldest retained bucket is skipped", () => {
  // Stored history ends at T0+2M, but the retained ticks start in bucket 5 (server was down / older ticks pruned).
  const obs = [...dense(5, [100, 101, 102, 103]), ...dense(6, [103, 104, 102, 104]), ...dense(7, [104, 105, 103, 105])];
  const f = fakes({ "KRW-BTC": obs }, { "KRW-BTC": T0 + 2 * M });
  const [r] = collectClosedCandles({ markets: ["KRW-BTC"], nowMs: T0 + 8 * M, observations: f.observations, sink: f.sink });
  assert.equal(r.recorded, 2);
  assert.equal(r.incompleteBuckets, 1);
  assert.deepEqual(f.appended[0].candles.map((c) => c.closeTimeMs), [T0 + 7 * M, T0 + 8 * M]);
});

test("a market without observations is reported and one failing market does not stop the others", () => {
  const f = fakes({ "KRW-ETH": [...dense(0, [1, 1, 1, 1]), ...dense(1, [2, 2, 2, 2]), ...dense(2, [3, 3, 3, 3])] });
  const failing = { ...f.sink, latestCloseTime: (market) => { if (market === "KRW-XRP") { const e = new Error("boom"); e.code = "CANDLE_CONFLICT"; throw e; } return undefined; } };
  const results = collectClosedCandles({ markets: ["KRW-BTC", "KRW-XRP", "KRW-ETH"], nowMs: T0 + 5 * M, observations: f.observations, sink: failing });
  assert.deepEqual(results.map((r) => [r.market, r.status]), [["KRW-BTC", "NO_OBSERVATIONS"], ["KRW-XRP", "ERROR"], ["KRW-ETH", "COLLECTED"]]);
  assert.equal(results[1].errorCode, "CANDLE_CONFLICT");
  assert.equal(results[2].recorded, 2);
});

test("misconfiguration throws", () => {
  const f = fakes({});
  assert.throws(() => collectClosedCandles({ markets: [], nowMs: T0, observations: f.observations, sink: f.sink }));
  assert.throws(() => collectClosedCandles({ markets: ["KRW-BTC", "KRW-BTC"], nowMs: T0, observations: f.observations, sink: f.sink }));
  assert.throws(() => collectClosedCandles({ markets: ["KRW-BTC"], nowMs: 0, observations: f.observations, sink: f.sink }));
});

test("end to end on the real SQLite observation repository and candle store, and a second pass adds nothing twice", () => {
  const db = new SqliteDatabase(join(mkdtempSync(join(tmpdir(), "nusa-collect-")), "c.db"));
  const observations = new SqlitePaperMarketObservationRepository(db);
  const store = new SqliteResearchCandleStore(db);
  const ticks = [...dense(0, [100, 101, 102, 103]), ...dense(1, [103, 110, 100, 104]), ...dense(2, [104, 105, 103, 105])];
  for (const t of ticks) assert.equal(observations.append({ market: "KRW-BTC", observedAt: t.observedAt, price: t.price }), "RECORDED");

  const first = collectClosedCandles({ markets: ["KRW-BTC"], nowMs: T0 + 3 * M, observations, sink: store });
  assert.equal(first[0].recorded, 2); // bucket 0 skipped (first-bucket rule), buckets 1 and 2 stored
  assert.deepEqual(store.read("KRW-BTC", M, 0, 99 * M), [
    { closeTimeMs: T0 + 2 * M, open: 103, high: 110, low: 100, close: 104 },
    { closeTimeMs: T0 + 3 * M, open: 104, high: 105, low: 103, close: 105 },
  ]);

  const second = collectClosedCandles({ markets: ["KRW-BTC"], nowMs: T0 + 3 * M, observations, sink: store });
  assert.equal(second[0].recorded, 0);
  assert.equal(store.count("KRW-BTC", M), 2);
  assert.equal(store.latestCloseTime("KRW-BTC", M), T0 + 3 * M);
  assert.equal(store.latestCloseTime("KRW-ETH", M), undefined);
  db.close();
});
