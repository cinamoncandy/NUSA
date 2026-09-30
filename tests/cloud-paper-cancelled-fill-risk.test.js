const test = require('node:test');
const assert = require('node:assert/strict');
const { SqliteDatabase } = require('../dist/packages/storage/src/index.js');
const { CloudPaperCanonicalRiskGateway, CLOUD_PAPER_RISK_LIMITS } = require('../dist/apps/cloud/src/cloudPaperCanonicalRiskGateway.js');
const NOW = Date.parse('2026-10-01T12:00:00Z');
const buy = { id: 'buy-fill', orderId: 'cancelled-buy', market: 'KRW-BTC', side: 'BUY', quantity: 2, price: 100, fee: 1, filledAt: NOW - 120_000 };
const sell = { id: 'sell-fill', orderId: 'sell', market: 'KRW-BTC', side: 'SELL', quantity: 1, price: 90, fee: 0, filledAt: NOW - 60_000 };
function evaluate({ fills = [sell, buy], limits = {}, side = 'BUY', orders } = {}) {
  const db = new SqliteDatabase(':memory:');
  try {
    const state = { version: 1, initialCapital: 100_000, cash: 99_889, equity: 99_989, realizedPnL: -10.5, unrealizedPnL: -0.5,
      positions: [{ market: 'KRW-BTC', quantity: 1, markPrice: 100, averageEntryPrice: 100.5, realizedPnL: -10.5, unrealizedPnL: -0.5 }],
      orders: orders ?? [{ ...buy, id: buy.orderId, status: 'CANCELLED', filledAt: NOW }, { ...sell, id: sell.orderId, status: 'FILLED' }],
      fills, processedIdempotencyKeys: [], updatedAt: NOW };
    const gateway = new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 100_000, sourceCommitSha: 'a'.repeat(40), limits: { ...CLOUD_PAPER_RISK_LIMITS, ...limits } });
    return gateway.evaluate({ path: 'STRATEGY', commandId: 'next', signalId: 'next', clientOrderId: 'next', strategyId: 'bound-candidate',
      market: 'KRW-BTC', side, quantity: 1, price: 100, now: NOW, observedAt: NOW, maximumMarketAgeMs: 30_000,
      killSwitchActive: false, openP0: false, overallHealth: 'HEALTHY', state });
  } finally { db.close(); }
}
test('cancelled partially filled BUY retains cost basis and allows the next valid request', () => {
  assert.equal(evaluate().status, 'ALLOW');
});
test('cancelled executions still enforce daily notional and realized-loss limits', () => {
  assert.ok(evaluate({ limits: { maxDailyBuyNotional: 150 } }).reasonCodes.includes('MAX_DAILY_BUY_NOTIONAL'));
  assert.ok(evaluate({ side: 'SELL', limits: { maxDailySellNotional: 80 } }).reasonCodes.includes('MAX_DAILY_SELL_NOTIONAL'));
  assert.ok(evaluate({ limits: { maxDailyLoss: 5 } }).reasonCodes.includes('DAILY_LOSS_LIMIT'));
});
test('daily limits use fill time rather than the later cancellation time', () => {
  const priorDay = [sell, buy].map(fill => ({ ...fill, filledAt: NOW - 86_400_000 }));
  assert.equal(evaluate({ fills: priorDay, limits: { maxDailyBuyNotional: 150 } }).status, 'ALLOW');
});
test('unfilled cancellation contributes no execution, but an unmatched sell remains fail-closed', () => {
  assert.equal(evaluate({ fills: [], orders: [{ ...buy, quantity: 0, id: buy.orderId, status: 'CANCELLED' }], limits: { maxDailyBuyNotional: 100 } }).status, 'ALLOW');
  assert.equal(evaluate({ fills: [sell] }).status, 'HALT');
  assert.deepEqual(evaluate({ fills: [sell] }).reasonCodes, ['INVALID_REQUEST']);
});
test('multiple partial fills count one order for burst limits, including cancelled orders', () => {
  const partials = [
    { ...buy, id: 'partial-2', quantity: 1, fee: 0.5, filledAt: NOW - 100 },
    { ...buy, id: 'partial-1', quantity: 1, fee: 0.5, filledAt: NOW - 200 },
  ];
  const orders = [{ ...buy, id: buy.orderId, status: 'CANCELLED' }];
  assert.equal(evaluate({ fills: partials, orders, limits: { maxOrdersPerSecond: 2 } }).status, 'ALLOW');
  assert.ok(evaluate({ fills: partials, orders }).reasonCodes.includes('ORDER_RATE_LIMIT_PER_SECOND'));
});
test('same-time fills preserve execution order, not lexical fill identity', () => {
  const fills = [{ ...sell, id: 'a-sell', filledAt: buy.filledAt }, { ...buy, id: 'z-buy' }];
  assert.equal(evaluate({ fills }).status, 'ALLOW');
});
test('duplicate or malformed executed evidence remains fail-closed', () => {
  assert.equal(evaluate({ fills: [sell, buy, buy] }).status, 'HALT');
  assert.equal(evaluate({ fills: [sell, { ...buy, quantity: NaN }] }).status, 'HALT');
});
