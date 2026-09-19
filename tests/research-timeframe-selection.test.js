const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESEARCH_TIMEFRAMES,
  RESEARCH_MARKET_SET_VERSION,
  researchTimeframe,
  researchCandleCount,
} = require("../scripts/research-real-market-run.js");

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

test("runtime candle depth must exactly match the timeframe availability declaration", () => {
  assert.equal(researchCandleCount(undefined, "1d"), 2000);
  assert.equal(researchCandleCount("2000", "1d"), 2000);
  assert.equal(researchCandleCount("1500", "60m"), 1500);
  assert.equal(researchCandleCount("4000", "240m"), 4000);

  assert.throws(() => researchCandleCount("500", "1d"), /not covered by upbit-public-daily-2000-v2/);
  assert.throws(() => researchCandleCount("1700", "60m"), /not covered by upbit-public-minute60-1500-v1/);
  assert.throws(() => researchCandleCount("1500", "240m"), /not covered by upbit-public-minute240-4000-v1/);
});

test("runtime candle depth rejects malformed and undeclared timeframe values", () => {
  assert.throws(() => researchCandleCount("abc", "1d"), /must be an integer/);
  assert.throws(() => researchCandleCount("2000", "5m"), /requires a declared timeframe/);
});
