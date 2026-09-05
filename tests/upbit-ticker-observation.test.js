const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyTickerRejectReason, upbitTickerToIntelligenceObservation } = require("../dist/apps/cloud/src/upbitTickerObservation.js");

const ticker = (overrides = {}) => ({
  type: "ticker",
  code: "KRW-BTC",
  trade_price: 100_000_000,
  trade_timestamp: 9_000,
  signed_change_rate: 0.0123,
  acc_trade_price_24h: 500_000_000,
  ...overrides
});

test("maps an Upbit ticker to stable, bounded, market-scoped intelligence evidence", () => {
  const observation = upbitTickerToIntelligenceObservation(ticker(), { now: 10_000, staleWindowMs: 2_000 });
  assert.deepEqual(observation, {
    id: "KRW-BTC:9000",
    source: "CHART",
    market: "KRW-BTC",
    sentiment: 0.41,
    rawChangeRate: 0.0123,
    normalizationPolicyId: "CHART_NORMALIZATION_V1",
    normalizationPolicyFingerprint: "13ff413b000defa68fd77a25b3e5b079caeecc783dda7f16cc7dd0e18f71295f",
    confidence: 0.25,
    observedAt: 9000,
    expiresAt: 11000,
    summary: "KRW-BTC 100000000 (+1.23%)"
  });
});

test("clamps sentiment and confidence to their contracts", () => {
  const observation = upbitTickerToIntelligenceObservation(ticker({ signed_change_rate: 99, acc_trade_price_24h: 99_000_000_000 }), { now: 9000 });
  assert.equal(observation.sentiment, 1);
  assert.equal(observation.confidence, 1);
  const negative = upbitTickerToIntelligenceObservation(ticker({ signed_change_rate: -99, acc_trade_price_24h: 0 }), { now: 9000 });
  assert.equal(negative.sentiment, -1);
  assert.equal(negative.confidence, 0);
});

test("normalizes realistic exchange returns with a dead-zone and preserves raw evidence", () => {
  const cases = [[0, 0], [0.002, 0], [0.005, 0.1667], [0.01, 0.3333], [0.02, 0.6667], [0.03, 1], [-0.01, -0.3333]];
  for (const [raw, normalized] of cases) {
    const observation = upbitTickerToIntelligenceObservation(ticker({ signed_change_rate: raw }), { now: 9000 });
    assert.equal(observation.rawChangeRate, raw);
    assert.equal(observation.sentiment, normalized);
    assert.equal(observation.normalizationPolicyId, "CHART_NORMALIZATION_V1");
    assert.match(observation.normalizationPolicyFingerprint, /^[a-f0-9]{64}$/);
  }
});

test("rejects stale, implausibly future, and non-KRW tickers", () => {
  assert.equal(upbitTickerToIntelligenceObservation(ticker(), { now: 12_001, staleWindowMs: 3_000 }), undefined);
  // Beyond the clock-skew allowance this is no longer explainable as drift.
  assert.equal(upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 12_000 }), { now: 11_000, clockSkewToleranceMs: 0 }), undefined);
  assert.equal(upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 20_000 }), { now: 11_000 }), undefined);
  assert.equal(upbitTickerToIntelligenceObservation(ticker({ code: "USDT-BTC" }), { now: 10_000 }), undefined);
});

test("a lagging local clock does not discard the live public feed", () => {
  // Observed in practice: this machine's clock sat ~670ms behind Upbit, so every genuine tick
  // looked future-dated. An exact comparison discarded all of them, the runtime saw no market
  // data, and the PAPER kill switch stayed closed permanently. Sub-second skew is ordinary and
  // must not be treated as a corrupted feed.
  const skewed = upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 10_670 }), { now: 10_000 });
  assert.ok(skewed, "a tick 670ms ahead of a lagging clock must still produce evidence");
  assert.equal(skewed.observedAt, 10_670);
  // Freshness is computed from a non-negative age, so a slightly-ahead tick reads as current
  // rather than as impossibly fresh.
  assert.ok(skewed.confidence > 0 && skewed.confidence <= 1);

  // The allowance is bounded and configurable, and its edge is inclusive.
  assert.ok(upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 15_000 }), { now: 10_000 }), "5s skew is within the default allowance");
  assert.equal(upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 15_001 }), { now: 10_000 }), undefined, "beyond the allowance is refused");
  assert.ok(upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 10_100 }), { now: 10_000, clockSkewToleranceMs: 100 }));
  assert.equal(upbitTickerToIntelligenceObservation(ticker({ trade_timestamp: 10_101 }), { now: 10_000, clockSkewToleranceMs: 100 }), undefined);
  assert.throws(() => upbitTickerToIntelligenceObservation(ticker(), { now: 10_000, clockSkewToleranceMs: -1 }), /clockSkewToleranceMs/);
});

test("reject reasons distinguish future, stale, malformed, and foreign ticks", () => {
  assert.equal(classifyTickerRejectReason(ticker(), { now: 10_000 }), "ACCEPTED");
  assert.equal(classifyTickerRejectReason(ticker(), { now: 12_001, staleWindowMs: 3_000 }), "FEED_STALE");
  assert.equal(classifyTickerRejectReason(ticker({ trade_timestamp: 20_000 }), { now: 11_000 }), "FUTURE_MARKET_TIMESTAMP");
  assert.equal(classifyTickerRejectReason(ticker({ code: "USDT-BTC" }), { now: 10_000 }), "MARKET_MISMATCH");
  assert.equal(classifyTickerRejectReason(ticker({ type: "trade" }), { now: 10_000 }), "NOT_TICKER");
  // An 80s-fast host clock (observed sandbox failure) classifies as stale
  // feed, never as valid — behavior unchanged, diagnosis improved.
  assert.equal(classifyTickerRejectReason(ticker({ trade_timestamp: 9_000 }), { now: 89_000 }), "FEED_STALE");
});

test("classifier agrees with the converter on every grid point (failure test)", () => {
  const timestamps = [0, 1_000, 8_999, 9_000, 9_001, 10_000, 10_670, 15_000, 15_001, 20_000, 100_000];
  const nows = [0, 9_000, 10_000, 11_000, 12_001, 89_000];
  const windows = [undefined, 1_000, 3_000, 30_000];
  const tolerances = [undefined, 0, 100, 5_000];
  const variants = [
    {},
    { type: "trade" },
    { code: "USDT-BTC" },
    { signed_change_rate: -0.5 },
  ];
  for (const trade_timestamp of timestamps) {
    for (const now of nows) {
      for (const staleWindowMs of windows) {
        for (const clockSkewToleranceMs of tolerances) {
          for (const variant of variants) {
            const options = { now, ...(staleWindowMs === undefined ? {} : { staleWindowMs }), ...(clockSkewToleranceMs === undefined ? {} : { clockSkewToleranceMs }) };
            const reason = classifyTickerRejectReason(ticker({ trade_timestamp, ...variant }), options);
            const accepted = upbitTickerToIntelligenceObservation(ticker({ trade_timestamp, ...variant }), options) !== undefined;
            assert.equal(reason === "ACCEPTED", accepted, `mismatch at ts=${trade_timestamp} now=${now} win=${staleWindowMs} tol=${clockSkewToleranceMs} variant=${JSON.stringify(variant)}`);
          }
        }
      }
    }
  }
});
