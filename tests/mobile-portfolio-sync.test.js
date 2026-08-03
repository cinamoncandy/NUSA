const test = require("node:test");
const assert = require("node:assert/strict");
const {
  JsonPortfolioRepository,
  MockPortfolioRepository,
  PortfolioSyncService,
  buildPortfolioSummary,
} = require("../dist/apps/mobile/src/portfolioDomain.js");
const { MockTradingService } = require("../dist/apps/mobile/src/tradingService.js");

const prices = new Map([["KRW/BTC", 12_000]]);

test("portfolio sync persists the projection after a filled buy", async () => {
  const trading = new MockTradingService([{ currency: "KRW", available: 100_000 }]);
  const repository = new MockPortfolioRepository();
  const service = new PortfolioSyncService(trading, repository);

  const result = await service.placePaperOrderAndSync({ market: "KRW/BTC", side: "BUY", quantity: 2, price: 10_000, nowMs: 1 }, prices);

  assert.equal(result.order.status, "FILLED");
  assert.equal(result.portfolio.assets[0].quantity, 2);
  assert.equal(result.portfolio.assets[0].averageEntryPrice, 10_000);
  assert.equal(result.portfolio.assets[0].unrealizedPnl, 4_000);
  assert.deepEqual(await service.restore(), result.portfolio);
});

test("portfolio sync calculates realized PnL after a sell fill", async () => {
  const trading = new MockTradingService([{ currency: "KRW", available: 100_000 }]);
  const repository = new MockPortfolioRepository();
  const service = new PortfolioSyncService(trading, repository);
  await service.placePaperOrderAndSync({ market: "KRW/BTC", side: "BUY", quantity: 2, price: 10_000, nowMs: 1 }, prices);

  const result = await service.placePaperOrderAndSync({ market: "KRW/BTC", side: "SELL", quantity: 1, price: 12_000, nowMs: 2 }, prices);

  assert.equal(result.portfolio.assets[0].quantity, 1);
  assert.equal(result.portfolio.assets[0].averageEntryPrice, 10_000);
  assert.equal(result.portfolio.realizedPnl, 2_000);
  assert.equal(result.portfolio.unrealizedPnl, 2_000);
  assert.equal(result.portfolio.totalPnl, 4_000);
});

test("JSON portfolio repository survives restore and rejects corrupt data", async () => {
  const values = new Map();
  const storage = { read: async (key) => values.get(key) ?? null, write: async (key, value) => values.set(key, value) };
  const repository = new JsonPortfolioRepository(storage);
  const summary = buildPortfolioSummary({ orders: [], positions: [], balances: [{ currency: "KRW", available: 100_000 }] }, new Map());

  await repository.save(summary);
  assert.deepEqual(await repository.load(), summary);
  values.set("nusa.portfolio.summary.v1", "not-json");
  await assert.rejects(() => repository.load(), /portfolio persistence is invalid/);
});
