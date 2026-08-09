const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

const command = (overrides = {}) => ({
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey: "paper-runtime-00000001",
  market: "KRW-BTC",
  side: "BUY",
  orderType: "MARKET",
  quantity: 0.001,
  ...overrides
});
const context = (overrides = {}) => ({
  now: 1_700_000_000_100,
  marketPrice: 50_000_000,
  observedAt: 1_700_000_000_090,
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  ...overrides
});

function harness(readP0State = () => ({ openP0: false })) {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteCloudPaperAccountRepository(db);
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000, repository, readP0State });
  return { db, repository, loop };
}

test("manual PAPER order persists to the canonical SQLite account and survives loop reconstruction", () => {
  const { db, repository, loop } = harness();
  try {
    const first = loop.submitManualOrder(command(), context());
    assert.equal(first.status, "FILLED");
    assert.equal(first.orders.length, 1);
    assert.equal(first.state.orders.length, 1);
    assert.equal(first.state.positions[0].market, "KRW-BTC");
    assert.match(first.state.orders[0].commandFingerprint, /^[a-f0-9]{64}$/);
    const restored = new PaperTradingExecutionLoop({ initialCapital: 1_000_000, repository, readP0State: () => ({ openP0: false }) });
    assert.equal(restored.snapshot().orders.length, 1);
    assert.equal(restored.snapshot().orders[0].id, first.orders[0].id);
    assert.equal(restored.snapshot().processedIdempotencyKeys.includes(command().idempotencyKey), true);
  } finally { db.close(); }
});

test("manual PAPER exact duplicate cannot create a second fill", () => {
  const { db, loop } = harness();
  try {
    const first = loop.submitManualOrder(command(), context());
    const duplicate = loop.submitManualOrder(command(), context({ now: context().now + 1, observedAt: context().observedAt + 1 }));
    assert.equal(first.status, "FILLED");
    assert.equal(duplicate.status, "DUPLICATE");
    assert.equal(loop.snapshot().orders.length, 1);
    assert.equal(loop.snapshot().fills.length, 1);
    assert.equal(duplicate.orders[0].id, first.orders[0].id);
  } finally { db.close(); }
});

test("same idempotency key with a different canonical command fails closed before and after restart", () => {
  const { db, repository, loop } = harness();
  try {
    const first = loop.submitManualOrder(command(), context());
    assert.equal(first.status, "FILLED");

    const conflict = loop.submitManualOrder(command({ quantity: 0.002 }), context({ now: context().now + 1, observedAt: context().observedAt + 1 }));
    assert.equal(conflict.status, "REJECTED");
    assert.equal(conflict.reason, "IDEMPOTENCY_KEY_CONFLICT");
    assert.equal(loop.snapshot().orders.length, 1);
    assert.equal(loop.snapshot().fills.length, 1);

    const restored = new PaperTradingExecutionLoop({ initialCapital: 1_000_000, repository, readP0State: () => ({ openP0: false }) });
    const restoredConflict = restored.submitManualOrder(command({ side: "SELL" }), context({ now: context().now + 2, observedAt: context().observedAt + 2 }));
    assert.equal(restoredConflict.status, "REJECTED");
    assert.equal(restoredConflict.reason, "IDEMPOTENCY_KEY_CONFLICT");
    assert.equal(restored.snapshot().orders.length, 1);
    assert.equal(restored.snapshot().fills.length, 1);

    const restoredDuplicate = restored.submitManualOrder(command(), context({ now: context().now + 3, observedAt: context().observedAt + 3 }));
    assert.equal(restoredDuplicate.status, "DUPLICATE");
    assert.equal(restoredDuplicate.orders[0].id, first.orders[0].id);
  } finally { db.close(); }
});

test("manual PAPER order is blocked by P0, kill switch, unhealthy state, and stale market without mutation", () => {
  const blockedCases = [
    { p0: true, ctx: context(), reason: "OPEN_P0_ALERT" },
    { p0: false, ctx: context({ killSwitchActive: true }), reason: "paper execution gate is closed" },
    { p0: false, ctx: context({ overallHealth: "DEGRADED" }), reason: "paper execution gate is closed" },
    { p0: false, ctx: context({ observedAt: context().now - 30_000 }), reason: "market data is stale" }
  ];
  for (const item of blockedCases) {
    const { db, loop } = harness(() => ({ openP0: item.p0 }));
    try {
      const before = JSON.stringify(loop.snapshot());
      const result = loop.submitManualOrder(command({ idempotencyKey: `paper-block-${String(item.reason).replace(/[^a-z]/gi, "x").padEnd(16, "x")}` }), item.ctx);
      assert.equal(result.status, "BLOCKED");
      assert.equal(result.reason, item.reason);
      assert.equal(JSON.stringify(loop.snapshot()), before);
    } finally { db.close(); }
  }
});

test("non-marketable limit order rejects without recording an idempotency key", () => {
  const { db, loop } = harness();
  try {
    const result = loop.submitManualOrder(command({ idempotencyKey: "paper-limit-00000001", orderType: "LIMIT", limitPrice: 49_000_000 }), context());
    assert.equal(result.status, "REJECTED");
    assert.equal(result.reason, "PAPER_LIMIT_NOT_MARKETABLE");
    assert.equal(loop.snapshot().orders.length, 0);
    assert.equal(loop.snapshot().processedIdempotencyKeys.length, 0);
  } finally { db.close(); }
});

test("manual PAPER sell cannot exceed the simulated position", () => {
  const { db, loop } = harness();
  try {
    const result = loop.submitManualOrder(command({ idempotencyKey: "paper-sell-000000001", side: "SELL", quantity: 0.001 }), context());
    assert.equal(result.status, "REJECTED");
    assert.match(result.reason, /insufficient paper position/);
    assert.equal(loop.snapshot().orders.length, 0);
  } finally { db.close(); }
});
