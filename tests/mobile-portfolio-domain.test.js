const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPortfolioSummary, MockPortfolioRepository } = require("../dist/apps/mobile/src/portfolioDomain.js");

const snapshot = (orders, positions, balances = [{ currency: "KRW", available: 80_000 }]) => ({ orders, positions, balances });

test("portfolio projection calculates holdings, equity, and unrealized PnL", () => {
  const result = buildPortfolioSummary(snapshot([], [{ market: "KRW/BTC", quantity: 2, averageEntryPrice: 10_000 }]), new Map([["KRW/BTC", 12_000]]));
  assert.equal(result.cash, 80_000);
  assert.equal(result.assetValue, 24_000);
  assert.equal(result.equity, 104_000);
  assert.equal(result.unrealizedPnl, 4_000);
});

test("portfolio projection derives realized PnL from completed paper orders", () => {
  const orders = [
    { id: "paper-1", market: "KRW/BTC", side: "BUY", quantity: 2, price: 10_000, status: "FILLED", createdAtMs: 1 },
    { id: "paper-2", market: "KRW/BTC", side: "SELL", quantity: 1, price: 12_000, status: "FILLED", createdAtMs: 2 },
  ];
  const result = buildPortfolioSummary(snapshot(orders, [{ market: "KRW/BTC", quantity: 1, averageEntryPrice: 10_000 }], [{ currency: "KRW", available: 82_000 }]), new Map([["KRW/BTC", 11_000]]));
  assert.equal(result.realizedPnl, 2_000);
  assert.equal(result.unrealizedPnl, 1_000);
  assert.equal(result.totalPnl, 3_000);
});

test("portfolio repository persists a projection without exposing mutable state", async () => {
  const repository = new MockPortfolioRepository();
  const result = buildPortfolioSummary(snapshot([], []), new Map());
  await repository.save(result);
  assert.deepEqual(await repository.load(), result);
});
