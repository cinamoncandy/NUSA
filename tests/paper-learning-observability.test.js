const assert = require('node:assert/strict');
const test = require('node:test');
const { PaperLearningEventRecorder, paperLearningCycleId } = require('../dist/apps/cloud/src/paperLearningObservability.js');

test('PAPER learning observability replays one deterministic cycle without duplicates', () => {
  const recorder = new PaperLearningEventRecorder();
  const cycleId = paperLearningCycleId('krw-btc', 1000);
  const base = { cycleId, occurredAt: 1100, market: 'KRW-BTC', status: 'PASS' };
  recorder.record({ ...base, stage: 'MARKET_DATA', reason: 'fresh' });
  recorder.record({ ...base, stage: 'MARKET_DATA', reason: 'fresh' });
  recorder.record({ ...base, stage: 'DECISION', decision: { symbol: 'KRW-BTC', action: 'BUY', allocation: 0.1, confidence: 0.8, decidedAt: 1090 } });
  recorder.record({ ...base, stage: 'ORDER_INTENT' });
  recorder.record({ ...base, stage: 'FILL', idSuffix: 'fill-1', fill: { id: 'fill-1', orderId: 'order-1', side: 'BUY', quantity: 0.01, price: 100, fee: 0.001, filledAt: 1100 } });
  recorder.record({ ...base, stage: 'PNL', account: { cash: 999, equity: 1000, realizedPnL: 0, unrealizedPnL: 0, updatedAt: 1100 } });
  recorder.record({ ...base, stage: 'LEARNING', reason: 'PAPER_OUTCOME_FORWARDED_TO_RESEARCH' });
  const replay = recorder.replay();
  assert.equal(replay.length, 6);
  assert.deepEqual([...replay.map((event) => event.stage)].sort(), ['DECISION', 'FILL', 'LEARNING', 'MARKET_DATA', 'ORDER_INTENT', 'PNL'].sort());
  assert.ok(replay.every((event) => event.mode === 'PAPER'));
});
