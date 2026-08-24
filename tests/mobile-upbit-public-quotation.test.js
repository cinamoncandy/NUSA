const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { aggregatePublicCandles } = require("../dist/apps/mobile/src/chartViewModel.js");
const {
  loadUpbitPublicCandles,
  loadUpbitPublicMarkets,
  normalizeUpbitCandlePayload,
  normalizeUpbitTickerPayload,
  UpbitPublicQuotationError,
} = require("../dist/apps/mobile/src/upbitPublicQuotationClient.js");

const ticker = (overrides = {}) => ({ market: "KRW-BTC", trade_price: 100, signed_change_rate: -0.01, acc_trade_volume_24h: 12, timestamp: 1_700_000_000_000, ...overrides });
const candle = (openTime, overrides = {}) => ({ market: "KRW-BTC", candle_date_time_utc: new Date(openTime).toISOString().replace(".000Z", ""), opening_price: 100, high_price: 110, low_price: 90, trade_price: 105, candle_acc_trade_volume: 2, ...overrides });
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

function mockRequest(payload, status = 200, calls = []) {
  return async (url, init) => { calls.push({ url, init }); return response(payload, status); };
}

test("normal ticker payload maps to the existing WatchlistMarket contract", async () => {
  const markets = await loadUpbitPublicMarkets({ request: mockRequest([ticker()]) });
  assert.deepEqual(markets[0], { market: "KRW-BTC", price: 100, changeRate: -0.01, volume: 12, observedAt: "2023-11-14T22:13:20.000Z", source: "UPBIT_PUBLIC_TICKER" });
});

test("normal candles use Upbit OHLCV and reverse chronological responses become ascending", async () => {
  const candles = await loadUpbitPublicCandles({ market: "KRW-BTC", count: 2, request: mockRequest([candle(60_000), candle(0)]) });
  assert.deepEqual(candles.map((item) => item.openTime), [0, 60_000]);
  assert.equal(candles[0].source, "UPBIT_PUBLIC_CANDLE");
});

test("candle gaps are retained as gaps and incomplete aggregate intervals are discarded", () => {
  const parsed = normalizeUpbitCandlePayload([candle(240_000), candle(0), candle(60_000), candle(180_000)], "KRW-BTC");
  assert.deepEqual(parsed.map((item) => item.openTime), [0, 60_000, 180_000, 240_000]);
  assert.equal(aggregatePublicCandles(parsed, "5m").length, 0);
});

test("malformed, non-finite, negative, invalid-market, and invalid-timestamp data fail closed", () => {
  assert.throws(() => normalizeUpbitTickerPayload("not-an-array"), /response is invalid/);
  assert.throws(() => normalizeUpbitTickerPayload([ticker({ trade_price: Number.NaN })]), /trade price/);
  assert.throws(() => normalizeUpbitTickerPayload([ticker({ acc_trade_volume_24h: -1 })]), /trade volume/);
  assert.throws(() => normalizeUpbitTickerPayload([ticker({ market: "BTC" })]), /market/);
  assert.throws(() => normalizeUpbitTickerPayload([ticker({ timestamp: Infinity })]), /timestamp/);
  assert.throws(() => normalizeUpbitCandlePayload([candle(0, { high_price: Number.POSITIVE_INFINITY })], "KRW-BTC"), /OHLCV/);
});

test("HTTP failure is surfaced and quotation requests remain HTTPS GET-only without authorization", async () => {
  const calls = [];
  await assert.rejects(() => loadUpbitPublicMarkets({ request: mockRequest({ error: "rate limited" }, 429, calls) }), /unavailable \(429: rate limited\)/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.upbit\.com\/v1\/ticker\/all/);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers, undefined);
});

test("quotation requests rely entirely on native networking headers", async () => {
  // React Native/OkHttp supplies the platform headers. Upbit's 2026-07-31 handling can reject
  // duplicated headers with HTTP 400, so the JS request supplies no header overrides at all.
  const calls = [];
  await loadUpbitPublicMarkets({ request: mockRequest([ticker()], 200, calls) });
  assert.equal(calls[0].init.headers, undefined);
});

test("structured Upbit errors expose the server error code and message for real-device diagnosis", async () => {
  const calls = [];
  await assert.rejects(
    () => loadUpbitPublicCandles({
      market: "KRW-BTC",
      request: mockRequest({ error: { name: "validation_error", message: "invalid request parameter" } }, 400, calls),
    }),
    /unavailable \(400: validation_error: invalid request parameter\)/,
  );
  assert.equal(calls.length, 1);
});

test("a failed request carries a read-only diagnostic with the real URL, status, and error detail", async () => {
  const calls = [];
  const error = await loadUpbitPublicCandles({
    market: "KRW-BTC",
    count: 120,
    request: mockRequest({ error: { name: "validation_error", message: "invalid request parameter" } }, 400, calls),
  }).then(() => null, (rejection) => rejection);
  assert.ok(error instanceof UpbitPublicQuotationError);
  assert.equal(error.diagnostic.requestUrl, "https://api.upbit.com/v1/candles/minutes/1?market=KRW-BTC&count=120");
  assert.equal(error.diagnostic.method, "GET");
  assert.equal(error.diagnostic.status, 400);
  assert.equal(error.diagnostic.responseErrorName, "validation_error");
  assert.equal(error.diagnostic.responseErrorMessage, "invalid request parameter");
  assert.equal(error.diagnostic.responseContentType, "application/json");
  assert.equal(typeof error.diagnostic.timestamp, "string");
  assert.ok(!Number.isNaN(Date.parse(error.diagnostic.timestamp)));
});

test("a non-JSON error body fails safe instead of throwing out of the diagnostic path", async () => {
  const request = async () => new Response("not json", { status: 400, headers: { "content-type": "text/plain" } });
  const error = await loadUpbitPublicMarkets({ request }).then(() => null, (rejection) => rejection);
  assert.ok(error instanceof UpbitPublicQuotationError);
  assert.equal(error.diagnostic.status, 400);
  assert.equal(error.diagnostic.responseErrorName, undefined);
  assert.equal(error.diagnostic.responseErrorMessage, undefined);
  assert.equal(error.diagnostic.responseContentType, "text/plain");
  assert.match(error.message, /unavailable \(400\)\.$/);
});

test("an oversized upstream error message is truncated, not passed through verbatim", async () => {
  const longMessage = "x".repeat(500);
  const error = await loadUpbitPublicMarkets({
    request: mockRequest({ error: { name: "validation_error", message: longMessage } }, 400),
  }).then(() => null, (rejection) => rejection);
  assert.ok(error.diagnostic.responseErrorMessage.length <= 160);
});

test("the diagnostic never carries a credential-shaped field, even by field name", async () => {
  const error = await loadUpbitPublicMarkets({
    request: mockRequest({ error: { name: "validation_error", message: "invalid request parameter" } }, 400),
  }).then(() => null, (rejection) => rejection);
  const serialized = JSON.stringify(error.diagnostic).toLowerCase();
  for (const forbidden of ["authorization", "cookie", "token", "api-key", "apikey", "secret", "account", "session"]) {
    assert.equal(serialized.includes(forbidden), false, `diagnostic must not mention "${forbidden}"`);
  }
});

test("the diagnostic exposes a finalUserAgent field even when no native module is present", async () => {
  // This test runs under plain Node, where the react-native module cannot resolve, so
  // readNativeRequestDiagnostic() always falls back to null -- exactly the fail-safe path a
  // non-Android build or a native lookup failure also takes. The field must still exist (as
  // undefined) rather than being silently dropped from the diagnostic shape.
  const error = await loadUpbitPublicMarkets({
    request: mockRequest({ error: { name: "validation_error", message: "invalid request parameter" } }, 400),
  }).then(() => null, (rejection) => rejection);
  assert.ok("finalUserAgent" in error.diagnostic);
  assert.equal(error.diagnostic.finalUserAgent, undefined);
});

test("App keeps public Markets state independent from PAPER configuration and exposes stale refresh state", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /loadUpbitPublicMarkets/);
  assert.match(app, /loadUpbitPublicCandles/);
  assert.match(app, /status: "STALE"/);
  assert.match(app, /PUBLIC_REFRESH_INTERVAL_MS = 30_000/);
  assert.match(app, /activeTab !== "Markets"/);
  assert.match(app, /publicMarkets.status === "ERROR"/);
  assert.match(app, /marketsStale={publicMarkets.status === "STALE"}/);
  assert.match(app, /refreshing={publicRefreshing}/);
});
