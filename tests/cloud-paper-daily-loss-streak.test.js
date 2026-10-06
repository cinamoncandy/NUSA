const test = require('node:test');
const assert = require('node:assert/strict');
const { SqliteDatabase } = require('../dist/packages/storage/src/index.js');
const { CloudPaperCanonicalRiskGateway, CLOUD_PAPER_RISK_LIMITS } = require('../dist/apps/cloud/src/cloudPaperCanonicalRiskGateway.js');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 86_400_000;

// Three round trips, each a losing sell, ending `offset` ms before NOW.
function losingRoundTrips(offset) {
  const fills = [];
  for (let i = 0; i < 3; i += 1) {
    const t = NOW - offset - (3 - i) * 60_000;
    fills.push({ id: `b${i}`, orderId: `ob${i}`, market: 'KRW-BTC', side: 'BUY', quantity: 1, price: 100, fee: 0, filledAt: t });
    fills.push({ id: `s${i}`, orderId: `os${i}`, market: 'KRW-BTC', side: 'SELL', quantity: 1, price: 99, fee: 0, filledAt: t + 1_000 });
  }
  return fills;
}

function evaluate(fills, onGateway) {
  const db = new SqliteDatabase(':memory:');
  try {
    const state = { version: 1, initialCapital: 100_000, cash: 99_997, equity: 99_997, realizedPnL: -3, unrealizedPnL: 0,
      positions: [], orders: fills.map((fill) => ({ ...fill, id: fill.orderId, status: 'FILLED' })),
      fills: [...fills].reverse(), processedIdempotencyKeys: [], updatedAt: NOW };
    const gateway = new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 100_000, sourceCommitSha: 'a'.repeat(40),
      limits: { ...CLOUD_PAPER_RISK_LIMITS, maxDailyLoss: 1_000_000, maxSameSideStreak: 100, maxOrdersPerMinute: 1_000, maxOrdersPerSecond: 1_000, maxDailyBuyNotional: 1e12, maxDailySellNotional: 1e12 } });
    const result = gateway.evaluate({ path: 'STRATEGY', commandId: 'next', signalId: 'next', clientOrderId: 'next', strategyId: 'bound-candidate',
      market: 'KRW-BTC', side: 'BUY', quantity: 1, price: 100, now: NOW, observedAt: NOW, maximumMarketAgeMs: 30_000,
      killSwitchActive: false, openP0: false, overallHealth: 'HEALTHY', state });
    if (onGateway) onGateway(gateway);
    return result;
  } finally { db.close(); }
}

test('three losing sells today still trip the consecutive-loss limit', () => {
  assert.ok(evaluate(losingRoundTrips(60_000)).reasonCodes.includes('CONSECUTIVE_LOSS_LIMIT'));
});

test('a losing streak from a previous UTC day no longer blocks today', () => {
  const result = evaluate(losingRoundTrips(DAY));
  assert.equal(result.reasonCodes.includes('CONSECUTIVE_LOSS_LIMIT'), false, JSON.stringify(result.reasonCodes));
});

test('the loss-limit counts behind a decision are published for display: today only, integers only', () => {
  let session;
  evaluate(losingRoundTrips(60_000), (gateway) => { session = gateway.lossSession(); });
  assert.deepEqual(session, { evaluatedAt: NOW, consecutiveLossCount: 3, maxConsecutiveLosses: CLOUD_PAPER_RISK_LIMITS.maxConsecutiveLosses, todayCompletedSells: 3, todayLosingSells: 3 });
  evaluate(losingRoundTrips(DAY), (gateway) => { session = gateway.lossSession(); });
  assert.equal(session.todayCompletedSells, 0, 'yesterday\'s sells are not today\'s');
  assert.equal(session.consecutiveLossCount, 0);
  const db = new SqliteDatabase(':memory:');
  try { assert.equal(new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 100_000, sourceCommitSha: 'a'.repeat(40) }).lossSession(), null, 'nothing before the first evaluation'); } finally { db.close(); }
});
