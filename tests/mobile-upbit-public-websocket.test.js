const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UpbitPublicWebSocketClient,
  MockUpbitWebSocketTransport,
  buildUpbitSubscribeFrame,
  parseUpbitWebSocketTicker,
} = require("../dist/apps/mobile/src/upbitPublicWebSocketClient.js");

test("buildUpbitSubscribeFrame matches Upbit's required [ticket, type+codes, format] shape", () => {
  const frame = JSON.parse(buildUpbitSubscribeFrame(["KRW-BTC", "KRW-ETH"], "t1"));
  assert.deepEqual(frame, [{ ticket: "t1" }, { type: "ticker", codes: ["KRW-BTC", "KRW-ETH"] }, { format: "DEFAULT" }]);
});

test("parseUpbitWebSocketTicker normalizes a DEFAULT-format ticker push", () => {
  const ticker = parseUpbitWebSocketTicker(JSON.stringify({
    type: "ticker", code: "KRW-BTC", trade_price: 100_000_000,
    signed_change_rate: 0.0123, acc_trade_volume_24h: 456.7, timestamp: 1_700_000_000_000,
  }));
  assert.deepEqual(ticker, {
    market: "KRW-BTC", price: 100_000_000, changeRate: 0.0123, volume: 456.7,
    observedAt: new Date(1_700_000_000_000).toISOString(), source: "UPBIT_PUBLIC_TICKER",
  });
});

test("parseUpbitWebSocketTicker ignores non-ticker frames instead of throwing", () => {
  assert.equal(parseUpbitWebSocketTicker(JSON.stringify({ type: "PONG" })), null);
});

test("parseUpbitWebSocketTicker rejects malformed JSON", () => {
  assert.throws(() => parseUpbitWebSocketTicker("not-json"), /not valid JSON/);
});

test("client sends the full subscribe frame on connect and delivers parsed ticks", async () => {
  const transport = new MockUpbitWebSocketTransport();
  const received = [];
  const client = new UpbitPublicWebSocketClient((ticker) => received.push(ticker), { transport, heartbeatMs: 10_000, ticketFactory: () => "fixed-ticket" });
  client.setMarkets(["KRW-BTC", "KRW-ETH"]);
  await client.connect();
  assert.equal(client.status, "CONNECTED");
  assert.deepEqual(JSON.parse(transport.sent[0]), [{ ticket: "fixed-ticket" }, { type: "ticker", codes: ["KRW-BTC", "KRW-ETH"] }, { format: "DEFAULT" }]);
  transport.sockets[0].emit(JSON.stringify({ type: "ticker", code: "KRW-BTC", trade_price: 1, signed_change_rate: 0, acc_trade_volume_24h: 0, timestamp: 1 }));
  assert.equal(received.length, 1);
  assert.equal(received[0].market, "KRW-BTC");
  client.disconnect();
});

test("setMarkets after connect resends the subscribe frame with the replaced full set", async () => {
  const transport = new MockUpbitWebSocketTransport();
  const client = new UpbitPublicWebSocketClient(() => {}, { transport, heartbeatMs: 10_000, ticketFactory: () => "t" });
  client.setMarkets(["KRW-BTC"]);
  await client.connect();
  client.setMarkets(["KRW-BTC", "KRW-XRP"]);
  const last = JSON.parse(transport.sent[transport.sent.length - 1]);
  assert.deepEqual(last[1], { type: "ticker", codes: ["KRW-BTC", "KRW-XRP"] });
  client.disconnect();
});

test("client reconnects with bounded exponential backoff and resubscribes to the current market set", async () => {
  const transport = new MockUpbitWebSocketTransport();
  const client = new UpbitPublicWebSocketClient(() => {}, { transport, reconnectBaseMs: 1, reconnectMaxMs: 4, heartbeatMs: 10_000, ticketFactory: () => "t" });
  client.setMarkets(["KRW-ETH"]);
  await client.connect();
  transport.sockets[0].close();
  assert.equal(client.status, "RECONNECTING");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(transport.sockets.length, 2);
  assert.ok(transport.sent.some((message) => message.includes("KRW-ETH")));
  client.disconnect();
});

test("client stops heartbeat and reconnect timers on disconnect", async () => {
  const transport = new MockUpbitWebSocketTransport();
  const client = new UpbitPublicWebSocketClient(() => {}, { transport, heartbeatMs: 1 });
  await client.connect();
  const socket = transport.sockets[0];
  client.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(client.status, "CLOSED");
  assert.equal(socket.closed, true);
  assert.equal(transport.sent.length, 0);
});

test("client silently ignores a malformed ticker frame instead of crashing the connection", async () => {
  const transport = new MockUpbitWebSocketTransport();
  const received = [];
  const client = new UpbitPublicWebSocketClient((ticker) => received.push(ticker), { transport, heartbeatMs: 10_000 });
  await client.connect();
  assert.doesNotThrow(() => transport.sockets[0].emit("not-json"));
  assert.equal(received.length, 0);
  assert.equal(client.status, "CONNECTED");
  client.disconnect();
});

test("heartbeat sends a bare PING frame to keep an idle connection alive", async () => {
  const transport = new MockUpbitWebSocketTransport();
  const client = new UpbitPublicWebSocketClient(() => {}, { transport, heartbeatMs: 5 });
  await client.connect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(transport.sent.includes("PING"));
  client.disconnect();
});
