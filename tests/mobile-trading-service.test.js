const test = require("node:test");
const assert = require("node:assert/strict");
const { ApiTradingService, MockTradingService } = require("../dist/apps/mobile/src/tradingService.js");

test("paper trading service fills a buy and projects balance and position", async () => {
  const service = new MockTradingService([{ currency: "KRW", available: 100000 }]);
  const order = await service.placePaperOrder({ market: "KRW/BTC", side: "BUY", quantity: 2, price: 10000, nowMs: 1 });
  const snapshot = await service.getSnapshot();
  assert.equal(order.status, "FILLED");
  assert.deepEqual(snapshot.balances, [{ currency: "KRW", available: 80000 }, { currency: "BTC", available: 2 }]);
  assert.deepEqual(snapshot.positions, [{ market: "KRW/BTC", quantity: 2, averageEntryPrice: 10000 }]);
});

test("paper trading service rejects duplicate or invalid balance mutations", async () => {
  const service = new MockTradingService([{ currency: "KRW", available: 10000 }]);
  await assert.rejects(() => service.placePaperOrder({ market: "KRW/BTC", side: "BUY", quantity: 2, price: 10000, nowMs: 1 }), /insufficient quote balance/);
  await assert.rejects(() => service.placePaperOrder({ market: "KRW/BTC", side: "SELL", quantity: 1, price: 10000, nowMs: 2 }), /insufficient base balance/);
  await assert.rejects(() => service.placePaperOrder({ market: "KRW/BTC", side: "BUY", quantity: 0, price: 10000, nowMs: 3 }), /quantity must be positive/);
});

test("paper trading service uses weighted average and closes a position", async () => {
  const service = new MockTradingService([{ currency: "KRW", available: 100000 }]);
  await service.placePaperOrder({ market: "KRW/BTC", side: "BUY", quantity: 1, price: 10000, nowMs: 1 });
  await service.placePaperOrder({ market: "KRW/BTC", side: "BUY", quantity: 1, price: 20000, nowMs: 2 });
  let snapshot = await service.getSnapshot();
  assert.equal(snapshot.positions[0].averageEntryPrice, 15000);
  await service.placePaperOrder({ market: "KRW/BTC", side: "SELL", quantity: 2, price: 12000, nowMs: 3 });
  snapshot = await service.getSnapshot();
  assert.deepEqual(snapshot.positions, []);
  assert.equal(snapshot.balances.find((balance) => balance.currency === "KRW")?.available, 94000);
});

test("API trading service keeps paper endpoints behind the API client", async () => {
  const calls = [];
  const api = { get: async (path) => { calls.push(["GET", path]); return { status: 200, data: { orders: [], positions: [], balances: [] } }; }, post: async (path, body) => { calls.push(["POST", path, body]); return { status: 200, data: { id: "paper-1", ...body, status: "FILLED" } }; } };
  const service = new ApiTradingService(api);
  await service.getSnapshot();
  await service.placePaperOrder({ market: "KRW/BTC", side: "BUY", quantity: 1, price: 100, nowMs: 1 });
  assert.equal(calls[0][1], "/paper/trading/snapshot");
  assert.equal(calls[1][1], "/paper/trading/orders");
});
