const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const {
  normalizeUpbitMarkets,
  parseUpbitPublicMessage,
  MockUpbitWebSocketTransport,
  UpbitWebSocketClient,
  shouldAcceptUpbitTicker,
  upbitReconnectDelay
} = require("../dist/apps/desktop/src/exchange/upbitWebSocket.js");

const ticker = (overrides = {}) => ({
  type: "ticker",
  code: "KRW-BTC",
  trade_price: 100000000,
  trade_timestamp: 1000,
  ...overrides
});

test("stopping a real CONNECTING Node ws socket contains its asynchronous abort error", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const WebSocket = require('ws');
    const { UpbitWebSocketClient } = require(${JSON.stringify(require.resolve("../dist/apps/desktop/src/exchange/upbitWebSocket.js"))});
    const socket = new WebSocket('ws://127.0.0.1:9');
    if (socket.readyState !== WebSocket.CONNECTING) throw new Error('fixture not CONNECTING');
    const client = new UpbitWebSocketClient('KRW-BTC', () => {}, () => {}, 2, 2000, { createSocket: () => socket });
    client.start();
    client.stop();
    client.stop();
    setImmediate(() => {
      if (socket.readyState !== WebSocket.CLOSED || client.activeTimerCount() !== 0 || client.currentHealth() !== 'DISCONNECTED') process.exitCode = 2;
    });
  `], { encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("retired errors cannot mutate a replacement while active errors still degrade health", () => {
  const sockets = [];
  const client = new UpbitWebSocketClient("KRW-BTC", () => {}, () => {}, 2, 2000, {
    createSocket: () => {
      const socket = new EventEmitter();
      socket.readyState = 0;
      socket.close = () => { socket.readyState = 3; };
      socket.send = () => {};
      sockets.push(socket);
      return socket;
    }
  });
  try {
    client.start();
    sockets[0].emit("error", new Error("active failure"));
    assert.equal(client.currentHealth(), "DEGRADED");
    client.stop();
    client.start();
    assert.equal(client.currentHealth(), "CONNECTING");
    assert.doesNotThrow(() => sockets[0].emit("error", new Error("late retirement failure")));
    sockets[0].emit("open");
    sockets[0].emit("pong");
    sockets[0].emit("close");
    assert.equal(client.currentHealth(), "CONNECTING");
    assert.equal(client.lastPongTimestamp(), undefined);
    assert.equal(client.activeTimerCount(), 1);
    assert.equal(sockets[0].listenerCount("message"), 0);
    sockets[1].emit("error", new Error("replacement failure"));
    assert.equal(client.currentHealth(), "DEGRADED");
  } finally { client.stop(); }
  assert.equal(client.activeTimerCount(), 0);
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

test("a live-magnitude sequential_id is accepted rather than rejected as a bad timestamp", () => {
  // Upbit's real sequential_id (~1.79e16) exceeds Number.MAX_SAFE_INTEGER. Validating it as a
  // timestamp rejected every genuine trade message, and each rejection degraded the feed and
  // cleared the ticker intelligence, so PAPER could never leave the kill-switched state. The
  // previous fixture used 22, which is a safe integer, so it never exercised real traffic.
  const liveSequentialId = 17870976536110000;
  assert.equal(Number.isSafeInteger(liveSequentialId), false, "fixture must reproduce the unsafe magnitude");
  const parsed = parseUpbitPublicMessage(JSON.stringify({
    type: "trade", code: "KRW-BTC", trade_price: 90925000, trade_volume: 0.001,
    ask_bid: "BID", trade_timestamp: 1787097653611, sequential_id: liveSequentialId
  }));
  assert.equal(parsed.type, "trade");
  assert.equal(parsed.sequential_id, liveSequentialId);
  // trade_timestamp is a genuine timestamp and keeps its stricter safe-integer contract.
  assert.throws(() => parseUpbitPublicMessage(JSON.stringify({
    type: "trade", code: "KRW-BTC", trade_price: 100, trade_volume: 0.01,
    ask_bid: "BID", trade_timestamp: 1.5, sequential_id: 22
  })), /trade_timestamp/);
  // A nonsense sequence id is still refused.
  for (const bad of [0, -1, Number.NaN, "22"]) {
    assert.throws(() => parseUpbitPublicMessage(JSON.stringify({
      type: "trade", code: "KRW-BTC", trade_price: 100, trade_volume: 0.01,
      ask_bid: "BID", trade_timestamp: 1001, sequential_id: bad
    })), /sequential_id/, `sequential_id ${String(bad)} must be rejected`);
  }
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


test("stale open public feed closes itself and enters bounded reconnect", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const transport = new MockUpbitWebSocketTransport();
  let now = 1_000;
  const states = [];
  const client = new UpbitWebSocketClient("KRW-BTC", () => {}, () => {}, 2, 2_000, {
    transport,
    now: () => now,
    onConnectionState: (diagnostics) => states.push(diagnostics.marketConnectionState)
  });
  t.after(() => client.stop());
  client.start();
  const first = transport.sockets[0];
  first.open();

  now = 3_100;
  t.mock.timers.tick(1_000);
  assert.equal(first.closed, true, "stale OPEN socket must be closed");
  assert.equal(states.includes("STALE"), true);
  assert.equal(states.includes("RECONNECTING"), true);
  assert.equal(client.activeTimerCount(), 2, "heartbeat plus exactly one reconnect timer");

  t.mock.timers.tick(1_000);
  assert.equal(transport.sockets.length, 2, "bounded reconnect creates one replacement socket");
  const replacement = transport.sockets[1];
  replacement.open();
  replacement.emitMessage(JSON.stringify(ticker({ trade_timestamp: 3_200 })));
  assert.equal(client.currentHealth(), "CONNECTED");
  assert.equal(client.activeTimerCount(), 1, "reconnect timer clears after recovery");
});
