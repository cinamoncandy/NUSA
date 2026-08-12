const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

const market = "KRW-BTC";

function tick(sequence) {
  const at = 10_000 + sequence;
  return {
    now: at,
    market,
    price: 100,
    quantity: 0.01,
    observedAt: at,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    decisions: [{
      symbol: market,
      action: "BUY",
      confidence: 1,
      risk: "LOW",
      allocation: 0.01,
      leverage: 1,
      score: 0.8,
      reasons: ["idempotency-retention-test"],
      decidedAt: at
    }]
  };
}

test("PAPER idempotency tombstones survive display-history pruning and restart", () => {
  const initialCapital = 1_000_000;
  const first = new PaperTradingExecutionLoop({ initialCapital, feeRate: 0 });

  for (let sequence = 0; sequence <= 2_000; sequence += 1) {
    assert.equal(first.processTick(tick(sequence)).status, "FILLED");
  }

  const persisted = first.snapshot();
  assert.equal(persisted.orders.length, 1_000, "display order history remains bounded");
  assert.equal(persisted.fills.length, 1_000, "display fill history remains bounded");
  assert.equal(persisted.processedIdempotencyKeys.length, 2_001, "execution tombstones must not be pruned with display history");

  const firstKey = `paper:${market}:10000:BUY:10000`;
  assert.equal(persisted.orders.some((order) => order.idempotencyKey === firstKey), false, "old order should already be outside display history");
  assert.equal(persisted.processedIdempotencyKeys.includes(firstKey), true, "old execution tombstone must remain durable");

  const restarted = new PaperTradingExecutionLoop({ initialCapital, feeRate: 0, restoredState: persisted });
  const before = restarted.snapshot();
  const replay = restarted.processTick(tick(0));

  assert.equal(replay.status, "DUPLICATE");
  assert.strictEqual(restarted.snapshot(), before, "replayed command must not publish a second fill after restart");
  assert.equal(restarted.snapshot().orders.length, 1_000);
  assert.equal(restarted.snapshot().fills.length, 1_000);
});
