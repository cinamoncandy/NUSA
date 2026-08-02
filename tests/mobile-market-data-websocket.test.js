const test = require("node:test");
const assert = require("node:assert/strict");
const { MarketDataWebSocketClient, MockWebSocketTransport } = require("../dist/apps/mobile/src/marketDataWebSocket.js");

test("market data client connects, normalizes ticker messages, and avoids duplicate subscriptions", async () => {
  const transport = new MockWebSocketTransport();
  const received = [];
  const client = new MarketDataWebSocketClient("wss://paper.test", transport, (ticker) => received.push(ticker), { heartbeatMs: 50 });
  client.subscribe("KRW-BTC");
  client.subscribe("KRW-BTC");
  await client.connect();
  transport.sockets[0].emit(JSON.stringify({ market: "KRW-BTC", lastPrice: 100, bidPrice: 99, askPrice: 101, timestampMs: 1 }));
  assert.equal(client.status, "CONNECTED");
  assert.equal(client.subscriptionCount, 1);
  assert.deepEqual(received[0], { market: "KRW-BTC", lastPrice: 100, bidPrice: 99, askPrice: 101, timestampMs: 1 });
  assert.equal(transport.sent.filter((message) => message.includes('"type":"subscribe"')).length, 1);
  client.disconnect();
});

test("market data client reconnects with bounded exponential backoff and resubscribes", async () => {
  const transport = new MockWebSocketTransport();
  const client = new MarketDataWebSocketClient("wss://paper.test", transport, () => {}, { reconnectBaseMs: 1, reconnectMaxMs: 4, maxReconnectAttempts: 2, heartbeatMs: 100 });
  client.subscribe("KRW-ETH");
  await client.connect();
  transport.sockets[0].close();
  assert.equal(client.status, "RECONNECTING");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(transport.sockets.length, 2);
  assert.ok(transport.sent.some((message) => message.includes("KRW-ETH")));
  assert.equal(client.nextReconnectDelayMs(), 1);
  client.disconnect();
});

test("market data client stops timers and subscriptions on disconnect", async () => {
  const transport = new MockWebSocketTransport();
  const client = new MarketDataWebSocketClient("wss://paper.test", transport, () => {}, { heartbeatMs: 1 });
  await client.connect();
  const socket = transport.sockets[0];
  client.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(client.status, "CLOSED");
  assert.equal(socket.closed, true);
  assert.equal(socket.pingCount, 0);
});

test("market data client rejects malformed ticker payloads", async () => {
  const transport = new MockWebSocketTransport();
  const client = new MarketDataWebSocketClient("wss://paper.test", transport, () => {});
  await client.connect();
  assert.throws(() => transport.sockets[0].emit("not-json"), /not valid JSON/);
  client.disconnect();
});
