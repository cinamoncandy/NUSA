const test = require("node:test");
const assert = require("node:assert/strict");

const contracts = require("../dist/packages/contracts/src/index.js");
const execution = require("../dist/apps/execution/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const orderStorage = require("../dist/packages/storage/src/order-idempotency.js");

const { LedgerSide } = contracts;
const {
  OrderAdmissionDecisionType,
  OrderAdmissionReasonCode,
  admitOrder
} = execution;
const { SqliteDatabase } = storage;
const { SqliteOrderIdempotencyRepository } = orderStorage;

function intent(overrides = {}) {
  return {
    intentId: "persistent-intent-1",
    idempotencyKey: "persistent-key-1",
    environment: "SYNTHETIC",
    accountId: "account-1",
    strategyId: "strategy-1",
    symbol: "BTC-USDT",
    side: LedgerSide.BUY,
    orderType: "MARKET",
    baseQtyRaw: 1n,
    quoteQtyRaw: 10n,
    createdAtMs: 1000,
    ...overrides
  };
}

function context() {
  return {
    nowMs: 1000,
    authorization: {
      environment: "SYNTHETIC",
      accountIds: ["account-1"],
      strategyIds: ["strategy-1"],
      symbols: ["BTC-USDT"],
      orderTypes: ["MARKET"],
      expiresAtMs: 2000
    },
    riskContext: { position: { baseQtyRaw: 0n, realizedPnlRaw: 0n } }
  };
}

test("idempotency survives repository reconstruction", () => {
  const db = new SqliteDatabase();
  try {
    const firstRepository = new SqliteOrderIdempotencyRepository(db);
    const first = admitOrder(intent(), context(), firstRepository);
    assert.equal(first.type, OrderAdmissionDecisionType.ALLOW);

    const reconstructedRepository = new SqliteOrderIdempotencyRepository(db);
    const duplicate = admitOrder(intent(), context(), reconstructedRepository);
    assert.equal(duplicate.type, OrderAdmissionDecisionType.DUPLICATE);
    assert.equal(reconstructedRepository.list().length, 1);
  } finally {
    db.close();
  }
});

test("economic intent replay under a new key is blocked after reconstruction", () => {
  const db = new SqliteDatabase();
  try {
    admitOrder(intent(), context(), new SqliteOrderIdempotencyRepository(db));
    const replay = admitOrder(
      intent({ idempotencyKey: "persistent-key-2" }),
      context(),
      new SqliteOrderIdempotencyRepository(db)
    );
    assert.equal(replay.type, OrderAdmissionDecisionType.BLOCK);
    assert.equal(replay.reasonCode, OrderAdmissionReasonCode.INTENT_REPLAYED_WITH_DIFFERENT_KEY);
  } finally {
    db.close();
  }
});

test("changed payload for a persisted key is blocked", () => {
  const db = new SqliteDatabase();
  try {
    const repository = new SqliteOrderIdempotencyRepository(db);
    admitOrder(intent(), context(), repository);
    const changed = admitOrder(intent({ baseQtyRaw: 2n }), context(), repository);
    assert.equal(changed.type, OrderAdmissionDecisionType.BLOCK);
    assert.equal(changed.reasonCode, OrderAdmissionReasonCode.PAYLOAD_CHANGED_FOR_IDEMPOTENCY_KEY);
    assert.equal(repository.list().length, 1);
  } finally {
    db.close();
  }
});
