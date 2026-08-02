const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUpbitMarkets,
  parseUpbitPublicMessage,
  MockUpbitWebSocketTransport,
  UpbitWebSocketClient,
  shouldAcceptUpbitTicker,
  upbitReconnectDelay
} = require("../dist/apps/desktop/src/upbitWebSocket.js");

const ticker = (overrides = {}) => ({
  type: "ticker",
  code: "KRW-BTC",
  trade_price: 100000000,
  trade_timestamp: 1000,
  ...overrides
});

test("market subscriptions are normalized, deduplicated, and validated", () => {
  assert.deepEqual(normalizeUpbitMarkets([" krw-btc ", "KRW-ETH", "KRW-BTC"]), ["KRW-BTC", "KRW-ETH"]);
  assert.deepEqual(normalizeUpbitMarkets("krw-btc"), ["KRW-BTC"]);
  assert.throws(() => normalizeUpbitMarkets([" "]), /at least one/);
});

test("reconnect delay uses bounded exponential backoff", () => {
  assert.equal(upbitReconnectDelay(1), 1000);
  assert.equal(upbitReconnectDelay(2), 2000);
  assert.equal(upbitReconnectDelay(3), 4000);
  assert.equal(upbitReconnectDelay(6), 30000);
  assert.equal(upbitReconnectDelay(20), 30000);
  assert.throws(() => upbitReconnectDelay(0), /positive safe integer/);
});

test("ticker acceptance rejects unrelated, invalid, duplicate, and out-of-order messages", () => {
  const markets = ["KRW-BTC", "KRW-ETH"];
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets), true);
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets, 999), true);
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets, 1000), false);
  assert.equal(shouldAcceptUpbitTicker(ticker(), markets, 1001), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ code: "KRW-XRP" }), markets), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ trade_price: 0 }), markets), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ trade_price: Number.NaN }), markets), false);
  assert.equal(shouldAcceptUpbitTicker(ticker({ trade_timestamp: -1 }), markets), false);
});

test("public parser normalizes ticker, trade, and orderbook payloads", () => {
  assert.equal(parseUpbitPublicMessage(JSON.stringify(ticker())).type, "ticker");
  assert.deepEqual(parseUpbitPublicMessage(JSON.stringify({
    type: "trade", code: "KRW-BTC", trade_price: 100, trade_volume: 0.01,
    ask_bid: "BID", trade_timestamp: 1001, sequential_id: 22
  })), {
    type: "trade", code: "KRW-BTC", trade_price: 100, trade_volume: 0.01,
    ask_bid: "BID", trade_timestamp: 1001, sequential_id: 22
  });
  assert.deepEqual(parseUpbitPublicMessage(JSON.stringify({
    type: "orderbook", code: "KRW-BTC", total_ask_size: 2, total_bid_size: 3,
    orderbook_units: [{ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 2 }]
  })), {
    type: "orderbook", code: "KRW-BTC", total_ask_size: 2, total_bid_size: 3,
    orderbook_units: [{ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 2 }]
  });
});

test("public parser rejects malformed and private channel payloads", () => {
  assert.throws(() => parseUpbitPublicMessage("not-json"), /not valid JSON/);
  assert.throws(() => parseUpbitPublicMessage(JSON.stringify({ type: "myOrder", code: "KRW-BTC" })), /unsupported/);
  assert.throws(() => parseUpbitPublicMessage(JSON.stringify({ type: "trade", code: "KRW-BTC", trade_price: 100, ask_bid: "BID" })), /trade_volume/);
});

test("mock public adapter routes streams, avoids duplicate subscriptions, and supports unsubscribe", (t) => {
  const transport = new MockUpbitWebSocketTransport();
  const trades = [];
  const orderBooks = [];
  const client = new UpbitWebSocketClient(["KRW-BTC", "KRW-ETH"], () => {}, () => {}, 2, 30_000, {
    transport,
    onTrade: (trade) => trades.push(trade),
    onOrderBook: (book) => orderBooks.push(book)
  });
  t.after(() => client.stop());
  client.start();
  const socket = transport.sockets[0];
  socket.open();
  client.subscribe(["KRW-BTC", "KRW-ETH", "KRW-BTC"]);
  socket.emitMessage(JSON.stringify({ type: "trade", code: "KRW-BTC", trade_price: 100, trade_volume: 0.1, ask_bid: "ASK", trade_timestamp: 2 }));
  socket.emitMessage(JSON.stringify({ type: "orderbook", code: "KRW-BTC", total_ask_size: 1, total_bid_size: 1, orderbook_units: [{ ask_price: 101, bid_price: 99, ask_size: 1, bid_size: 1 }] }));
  assert.equal(trades.length, 1);
  assert.equal(orderBooks.length, 1);
  assert.equal(JSON.parse(socket.sent.at(-1))[1].codes.length, 2);
  client.unsubscribe("KRW-ETH");
  assert.throws(() => client.unsubscribe("KRW-BTC"), /remain subscribed/);
  client.stop();
});

test("heartbeat sends ping and records pong without creating another timer", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const transport = new MockUpbitWebSocketTransport();
  let now = 100;
  const client = new UpbitWebSocketClient("KRW-BTC", () => {}, () => {}, 2, 2_000, { transport, now: () => now });
  client.start();
  const socket = transport.sockets[0];
  socket.open();
  now = 200;
  t.mock.timers.tick(1_000);
  assert.equal(socket.pingCount, 1);
  socket.emitPong();
  assert.equal(client.lastPongTimestamp(), 200);
  assert.equal(client.activeTimerCount(), 1);
  client.stop();
});
