const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  RESEARCH_TIMEFRAMES,
  RESEARCH_MARKET_SET_VERSION,
  researchTimeframe,
  researchCandleCount,
  declaredResearchCandleCount,
  createMarketDataset,
  buildPublishedFreshness,
} = require("../scripts/research-real-market-run.js");
const { UPBIT_INTERVAL_MS, evaluateUpbitCandleFreshness } = require("../dist/apps/desktop/src/exchange/upbitCandleAdapter.js");

const candleSeries = (market, interval, closeTime, count) => {
  const step = UPBIT_INTERVAL_MS[interval];
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const close = closeTime - (count - 1 - index) * step;
      return Object.freeze({
        market,
        interval,
        openTime: close - step,
        closeTime: close,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      });
    }),
  );
};

test("timeframe defaults to daily when unset", () => {
  for (const value of [undefined, "", "   "]) assert.equal(researchTimeframe(value), "1d");
});

test("timeframe accepts every declared interval, case-insensitively", () => {
  for (const tf of Object.keys(RESEARCH_TIMEFRAMES)) {
    assert.equal(researchTimeframe(tf), tf);
    assert.equal(researchTimeframe(tf.toUpperCase()), tf);
    assert.equal(researchTimeframe(` ${tf} `), tf);
  }
});

test("timeframe fails closed outside the declared intervals", () => {
  for (const tf of ["1m", "5m", "1w", "daily", "nonsense"]) {
    assert.throws(() => researchTimeframe(tf), /NUSA_RESEARCH_TIMEFRAME must be one of/);
  }
});

test("each timeframe carries its own market-set identity", () => {
  // "upbit-public-daily-2000-v2" is an availability claim about DAILY candles. Reusing it for a
  // minute run would attach that claim to evidence it was never made about, so the identities
  // must be distinct per timeframe.
  const identities = Object.values(RESEARCH_TIMEFRAMES).map((entry) => entry.marketSetVersion);
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(RESEARCH_TIMEFRAMES["1d"].marketSetVersion, "upbit-public-daily-2000-v2");
  assert.match(RESEARCH_TIMEFRAMES["60m"].marketSetVersion, /minute60/);
  assert.match(RESEARCH_TIMEFRAMES["240m"].marketSetVersion, /minute240/);
});

test("each timeframe declares the depth its contiguity was verified at", () => {
  // Reachability is not availability: KRW-BTC 60m has a real 4-hour hole at 2026-07-05, so 2000
  // 60m candles are reachable but not contiguous. The declared depth must be the verified one.
  for (const entry of Object.values(RESEARCH_TIMEFRAMES)) {
    assert.ok(Number.isInteger(entry.candleCount) && entry.candleCount >= 200, "depth must be a usable integer");
    assert.match(entry.marketSetVersion, new RegExp(String(entry.candleCount)), "identity must name its declared depth");
  }
  assert.equal(RESEARCH_TIMEFRAMES["60m"].candleCount, 1500);
  // 240m carries the only depth verified to span multiple regimes (5000 contiguous candles back
  // to 2024-06-07 across all five markets; 4000 declared for headroom).
  assert.equal(RESEARCH_TIMEFRAMES["240m"].candleCount, 4000);
});

test("the module resolves its market-set identity from the selected timeframe", () => {
  // Default process env in this test run is unset, so the daily identity must be in force.
  assert.equal(RESEARCH_MARKET_SET_VERSION, RESEARCH_TIMEFRAMES["1d"].marketSetVersion);
});

test("low-level pagination depth remains bounded without manufacturing an availability claim", () => {
  assert.equal(researchCandleCount("200"), 200);
  assert.equal(researchCandleCount("201"), 201);
  assert.equal(researchCandleCount("400"), 400);
  assert.throws(() => researchCandleCount("199"), /integer from 200/);
});

test("runtime candle depth must exactly match the timeframe availability declaration", () => {
  assert.equal(declaredResearchCandleCount(undefined, "1d"), 2000);
  assert.equal(declaredResearchCandleCount("2000", "1d"), 2000);
  assert.equal(declaredResearchCandleCount("1500", "60m"), 1500);
  assert.equal(declaredResearchCandleCount("4000", "240m"), 4000);

  assert.throws(() => declaredResearchCandleCount("500", "1d"), /not covered by upbit-public-daily-2000-v2/);
  assert.throws(() => declaredResearchCandleCount("1700", "60m"), /not covered by upbit-public-minute60-1500-v1/);
  assert.throws(() => declaredResearchCandleCount("1500", "240m"), /not covered by upbit-public-minute240-4000-v1/);
});

test("runtime candle depth rejects malformed and undeclared timeframe values", () => {
  assert.throws(() => declaredResearchCandleCount("abc", "1d"), /must be an integer/);
  assert.throws(() => declaredResearchCandleCount("2000", "5m"), /requires a declared timeframe/);
});

test("the generic freshness projection carries interval units and no day-named field", () => {
  // #1981 requirement 7. evaluateUpbitCandleFreshness reports lagIntervals; only the daily-named
  // wrapper reports lagDays. Reading lagDays off the generic result yields undefined, which is the
  // defect this guards, so assert the absence as well as the presence.
  for (const interval of ["1d", "60m", "240m"]) {
    const step = UPBIT_INTERVAL_MS[interval];
    const asOf = Math.floor(Date.now() / step) * step;
    const fresh = evaluateUpbitCandleFreshness(candleSeries("KRW-BTC", interval, asOf, 3), asOf, interval);
    assert.equal(Object.prototype.hasOwnProperty.call(fresh, "lagIntervals"), true, `${interval} must report lagIntervals`);
    assert.equal(Object.prototype.hasOwnProperty.call(fresh, "lagDays"), false, `${interval} must not report lagDays`);
    assert.equal(Number.isFinite(fresh.lagIntervals), true, `${interval} lagIntervals must be finite`);

    // One interval of trailing data is still one interval of lag, counted in intervals.
    const behind = evaluateUpbitCandleFreshness(candleSeries("KRW-BTC", interval, asOf - step, 3), asOf, interval);
    assert.equal(behind.lagIntervals, 1, `${interval} must count lag in intervals, not days`);
  }
});

test("emitted research freshness is defined for every declared timeframe", () => {
  // The run script emits dataset.freshness into hypothesis provenance. Before #1982 it copied
  // freshness.lagDays off the generic projection, so every non-daily run published
  // `lagDays: undefined`. createMarketDataset reads the module-level TIMEFRAME, fixed at load, so
  // each timeframe is exercised in its own process rather than by passing an interval in.
  for (const interval of ["1d", "60m", "240m"]) {
    const script = `
      const { createMarketDataset } = require("./scripts/research-real-market-run.js");
      const { UPBIT_INTERVAL_MS } = require("./dist/apps/desktop/src/exchange/upbitCandleAdapter.js");
      const interval = process.env.NUSA_RESEARCH_TIMEFRAME;
      const step = UPBIT_INTERVAL_MS[interval];
      const dataAsOf = Math.floor(Date.now() / step) * step;
      const candles = Array.from({ length: 40 }, (_, index) => {
        const closeTime = dataAsOf - (39 - index) * step;
        return { market: "KRW-BTC", interval, openTime: closeTime - step, closeTime, open: 100, high: 101, low: 99, close: 100, volume: 1 };
      });
      const dataset = createMarketDataset({ market: "KRW-BTC", dataAsOf, candles, sourceRequests: ["test"] });
      process.stdout.write(JSON.stringify({
        lagIntervals: dataset.freshness.lagIntervals,
        hasLagDays: Object.prototype.hasOwnProperty.call(dataset.freshness, "lagDays"),
        fresh: dataset.freshness.fresh,
        candleCount: dataset.manifest.candleCount,
      }));
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, NUSA_RESEARCH_TIMEFRAME: interval },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${interval} emission failed: ${result.stderr}`);
    const emitted = JSON.parse(result.stdout);
    assert.equal(Number.isFinite(emitted.lagIntervals), true, `${interval} emitted lagIntervals must be finite`);
    assert.equal(emitted.hasLagDays, false, `${interval} must not emit a day-named lag`);
    assert.equal(emitted.fresh, true);
    assert.equal(emitted.candleCount, 40);
  }
});

test("published provenance freshness carries interval lag and never a day-named field", () => {
  // This is the value that actually reaches hypothesis provenance, and the one #1982 repaired. It is
  // asserted through the exported builder because main() does network I/O: reading lagDays off the
  // generic projection published `lagDays: undefined` and nothing could observe it.
  for (const interval of ["1d", "60m", "240m"]) {
    const step = UPBIT_INTERVAL_MS[interval];
    const asOf = Math.floor(Date.now() / step) * step;
    const source = evaluateUpbitCandleFreshness(candleSeries("KRW-BTC", interval, asOf - step, 3), asOf, interval);

    const published = buildPublishedFreshness(source);
    assert.equal(published.lagIntervals, 1, `${interval} must publish lag in intervals`);
    assert.equal(Object.prototype.hasOwnProperty.call(published, "lagDays"), false, `${interval} must not publish lagDays`);
    assert.equal(published.status, "FRESH");
    assert.equal(published.expectedLatestCloseTime, new Date(source.expectedLatestCloseTime).toISOString());
    assert.equal(published.actualLatestCloseTime, new Date(source.actualLatestCloseTime).toISOString());
  }

  // A projection without a finite interval lag — the daily wrapper's shape — cannot be published.
  assert.throws(() => buildPublishedFreshness({ expectedLatestCloseTime: 0, actualLatestCloseTime: 0, lagDays: 1 }), /finite lagIntervals/);
  assert.throws(() => buildPublishedFreshness({ expectedLatestCloseTime: 0, actualLatestCloseTime: 0, lagIntervals: undefined }), /finite lagIntervals/);
  assert.throws(() => buildPublishedFreshness(undefined), /finite lagIntervals/);
});
