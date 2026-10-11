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

test('a losing streak from a previous trading day no longer blocks today', () => {
  const result = evaluate(losingRoundTrips(DAY));
  assert.equal(result.reasonCodes.includes('CONSECUTIVE_LOSS_LIMIT'), false, JSON.stringify(result.reasonCodes));
});

test('the loss-limit counts behind a decision are published for display: today only, integers only', () => {
  let session;
  evaluate(losingRoundTrips(60_000), (gateway) => { session = gateway.lossSession(); });
  assert.deepEqual(session, { evaluatedAt: NOW, consecutiveLossCount: 3, maxConsecutiveLosses: CLOUD_PAPER_RISK_LIMITS.maxConsecutiveLosses, todayCompletedSells: 3, todayLosingSells: 3,
    periodIdentity: '2026-10-01', periodStartedAt: Date.parse('2026-10-01T00:00:00+09:00'), lastIncrementAt: NOW - 60_000 - 60_000 + 1_000 });
  evaluate(losingRoundTrips(DAY), (gateway) => { session = gateway.lossSession(); });
  assert.equal(session.todayCompletedSells, 0, 'yesterday\'s sells are not today\'s');
  assert.equal(session.consecutiveLossCount, 0);
  assert.equal(session.lastIncrementAt, null, 'no streak, no last increment');
  const db = new SqliteDatabase(':memory:');
  try { assert.equal(new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 100_000, sourceCommitSha: 'a'.repeat(40) }).lossSession(), null, 'nothing before the first evaluation'); } finally { db.close(); }
});

// The trading day is the canonical Asia/Seoul day (the same one CanonicalRiskSafetyGate and the learning rollover use), so the
// streak resets at 15:00 UTC, not at 00:00 UTC.
function evaluateAt(now, fills) {
  const db = new SqliteDatabase(':memory:');
  try {
    const state = { version: 1, initialCapital: 100_000, cash: 99_997, equity: 99_997, realizedPnL: -3, unrealizedPnL: 0,
      positions: [], orders: fills.map((fill) => ({ ...fill, id: fill.orderId, status: 'FILLED' })),
      fills: [...fills].reverse(), processedIdempotencyKeys: [], updatedAt: now };
    const gateway = new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 100_000, sourceCommitSha: 'a'.repeat(40),
      limits: { ...CLOUD_PAPER_RISK_LIMITS, maxDailyLoss: 1_000_000, maxSameSideStreak: 100, maxOrdersPerMinute: 1_000, maxOrdersPerSecond: 1_000, maxDailyBuyNotional: 1e12, maxDailySellNotional: 1e12 } });
    const result = gateway.evaluate({ path: 'STRATEGY', commandId: 'next', signalId: 'next', clientOrderId: 'next', strategyId: 'bound-candidate',
      market: 'KRW-BTC', side: 'BUY', quantity: 1, price: 100, now, observedAt: now, maximumMarketAgeMs: 30_000,
      killSwitchActive: false, openP0: false, overallHealth: 'HEALTHY', state });
    return { result, session: gateway.lossSession() };
  } finally { db.close(); }
}

const LOSSES_AT_2330_KST = (() => {
  const base = Date.parse('2026-10-01T14:30:00Z'); // 23:30 KST on 2026-10-01
  const fills = [];
  for (let i = 0; i < 3; i += 1) {
    const t = base + i * 60_000;
    fills.push({ id: `kb${i}`, orderId: `okb${i}`, market: 'KRW-BTC', side: 'BUY', quantity: 1, price: 100, filledAt: t, fee: 0 });
    fills.push({ id: `ks${i}`, orderId: `oks${i}`, market: 'KRW-BTC', side: 'SELL', quantity: 1, price: 99, filledAt: t + 1_000, fee: 0 });
  }
  return fills;
})();

test('three losses stay blocked until the KST day boundary (15:00 UTC), even after 00:00 UTC has passed', () => {
  const before = evaluateAt(Date.parse('2026-10-01T14:59:00Z'), LOSSES_AT_2330_KST);
  assert.ok(before.result.reasonCodes.includes('CONSECUTIVE_LOSS_LIMIT'));
  assert.equal(before.session.consecutiveLossCount, 3);
  assert.equal(before.session.periodIdentity, '2026-10-01');
});

test('at the KST day boundary the streak resets exactly once and the new period is identified', () => {
  const after = evaluateAt(Date.parse('2026-10-01T15:00:00Z'), LOSSES_AT_2330_KST);
  assert.equal(after.result.reasonCodes.includes('CONSECUTIVE_LOSS_LIMIT'), false, JSON.stringify(after.result.reasonCodes));
  assert.equal(after.session.consecutiveLossCount, 0);
  assert.equal(after.session.todayCompletedSells, 0);
  assert.equal(after.session.periodIdentity, '2026-10-02');
  assert.equal(after.session.periodStartedAt, Date.parse('2026-10-02T00:00:00+09:00'));
  assert.equal(after.session.lastIncrementAt, null);
  // A restart (a fresh gateway over the same fills) after the boundary reaches the same truth.
  const restarted = evaluateAt(Date.parse('2026-10-01T15:00:30Z'), LOSSES_AT_2330_KST);
  assert.equal(restarted.session.consecutiveLossCount, 0);
  assert.equal(restarted.session.periodIdentity, '2026-10-02');
});

test('a restart before the boundary keeps the block, and the threshold is still three', () => {
  assert.equal(CLOUD_PAPER_RISK_LIMITS.maxConsecutiveLosses, 3);
  const restarted = evaluateAt(Date.parse('2026-10-01T14:59:30Z'), LOSSES_AT_2330_KST);
  assert.equal(restarted.session.consecutiveLossCount, 3);
  assert.equal(restarted.session.lastIncrementAt, Date.parse('2026-10-01T14:32:01Z'));
});
