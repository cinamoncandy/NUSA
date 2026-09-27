const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalUpbitSourceFingerprint,
  classifyMarketEventIntegrity,
  marketStreamCursor,
  normalizeUpbitPublicEvent
} = require("../dist/packages/core/src/canonicalMarketData.js");

const ticker = (overrides = {}) => ({
  type: "ticker",
  code: "KRW-BTC",
  trade_price: 100000000,
  trade_timestamp: 1000,
  signed_change_rate: 0.01,
  ...overrides
});

test("canonical event binds provider, stream, timestamps, normalizer and deterministic source fingerprint", () => {
  const left = normalizeUpbitPublicEvent(ticker(), 1100);
  const right = normalizeUpbitPublicEvent({ signed_change_rate: 0.01, trade_timestamp: 1000, trade_price: 100000000, code: "KRW-BTC", type: "ticker" }, 9999);
  assert.equal(left.provider, "UPBIT");
  assert.equal(left.source, "PUBLIC_WEBSOCKET");
  assert.equal(left.stream, "TICKER");
  assert.equal(left.market, "KRW-BTC");
  assert.equal(left.exchangeTimestamp, 1000);
  assert.equal(left.receivedAt, 1100);
  assert.equal(left.normalizerVersion, "upbit-public-v1");
  assert.match(left.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(left.sourceFingerprint, right.sourceFingerprint, "receive time and object key order cannot change source identity");
  assert.equal(canonicalUpbitSourceFingerprint(ticker()), left.sourceFingerprint);
});

test("duplicate and out-of-order events are explicit rather than silently accepted", () => {
  const first = normalizeUpbitPublicEvent(ticker(), 1100);
  const cursor = marketStreamCursor(first);
  assert.equal(classifyMarketEventIntegrity(ticker(), cursor), "DUPLICATE");
  assert.equal(classifyMarketEventIntegrity(ticker({ trade_timestamp: 999, trade_price: 99999999 }), cursor), "OUT_OF_ORDER");
  assert.equal(classifyMarketEventIntegrity(ticker({ trade_timestamp: 1001, trade_price: 100000001 }), cursor), "ACCEPTED");
});

test("large timestamp jumps are gap suspicion only because Upbit has no lossless universal sequence", () => {
  const first = normalizeUpbitPublicEvent(ticker(), 1100);
  assert.equal(classifyMarketEventIntegrity(ticker({ trade_timestamp: 61001, trade_price: 100000001 }), marketStreamCursor(first)), "GAP_SUSPECT");
});

test("trade sequence is provenance-only and orderbook correctly has no fabricated exchange timestamp", () => {
  const trade = normalizeUpbitPublicEvent({
    type: "trade", code: "KRW-BTC", trade_price: 100, trade_volume: 0.1,
    ask_bid: "BID", trade_timestamp: 2000, sequential_id: 17870976536110000
  }, 2100);
  assert.equal(trade.sequence, String(17870976536110000));
  const book = normalizeUpbitPublicEvent({
    type: "orderbook", code: "KRW-BTC", total_ask_size: 1, total_bid_size: 1,
    orderbook_units: [{ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 1 }]
  }, 2200);
  assert.equal(book.exchangeTimestamp, null);
  assert.equal(book.sequence, null);
  assert.equal(book.integrity, "ACCEPTED");
});

test("invalid receive time fails closed", () => {
  assert.throws(() => normalizeUpbitPublicEvent(ticker(), -1), /receivedAt/);
  assert.throws(() => normalizeUpbitPublicEvent(ticker(), 1.5), /receivedAt/);
});
