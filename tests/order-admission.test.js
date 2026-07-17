const test = require("node:test");
const assert = require("node:assert/strict");
const contracts = require("../dist/packages/contracts/src/index.js");
const execution = require("../dist/apps/execution/src/index.js");

const { LedgerSide, RiskReasonCode } = contracts;
const { OrderAdmissionDecisionType, OrderAdmissionReasonCode, InMemoryIdempotencyStore, admitOrder, hashOrderIntent } = execution;

function intent(overrides = {}) {
  return {
    intentId: "intent-1",
    idempotencyKey: "key-1",
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

function context(overrides = {}) {
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
    riskContext: { position: { baseQtyRaw: 0n, realizedPnlRaw: 0n } },
    riskPolicy: { maxOrderQuoteRaw: 100n, maxPositionBaseRaw: 2n },
    ...overrides
  };
}

test("authorized bounded intent is admitted once", () => {
  const store = new InMemoryIdempotencyStore();
  const first = admitOrder(intent(), context(), store);
  const second = admitOrder(intent(), context(), store);
  assert.equal(first.type, OrderAdmissionDecisionType.ALLOW);
  assert.equal(second.type, OrderAdmissionDecisionType.DUPLICATE);
  assert.equal(first.payloadHash, second.payloadHash);
});

test("same idempotency key with a changed economic payload is blocked", () => {
  const store = new InMemoryIdempotencyStore();
  admitOrder(intent(), context(), store);
  const changed = admitOrder(intent({ baseQtyRaw: 2n }), context(), store);
  assert.equal(changed.type, OrderAdmissionDecisionType.BLOCK);
  assert.equal(changed.reasonCode, OrderAdmissionReasonCode.PAYLOAD_CHANGED_FOR_IDEMPOTENCY_KEY);
});

test("same intent cannot be repackaged under a different idempotency key", () => {
  const store = new InMemoryIdempotencyStore();
  admitOrder(intent(), context(), store);
  const replay = admitOrder(intent({ idempotencyKey: "key-2", baseQtyRaw: 2n }), context(), store);
  assert.equal(replay.type, OrderAdmissionDecisionType.BLOCK);
  assert.equal(replay.reasonCode, OrderAdmissionReasonCode.INTENT_REPLAYED_WITH_DIFFERENT_KEY);
});

test("environment mismatch is blocked before risk evaluation", () => {
  const result = admitOrder(intent({ environment: "TESTNET" }), context(), new InMemoryIdempotencyStore());
  assert.equal(result.reasonCode, OrderAdmissionReasonCode.ENVIRONMENT_MISMATCH);
});

test("account strategy symbol and order type are explicitly scoped", () => {
  const cases = [
    [intent({ accountId: "other" }), OrderAdmissionReasonCode.ACCOUNT_NOT_AUTHORIZED],
    [intent({ strategyId: "other" }), OrderAdmissionReasonCode.STRATEGY_NOT_AUTHORIZED],
    [intent({ symbol: "ETH-USDT" }), OrderAdmissionReasonCode.SYMBOL_NOT_AUTHORIZED],
    [intent({ orderType: "LIMIT" }), OrderAdmissionReasonCode.ORDER_TYPE_NOT_AUTHORIZED]
  ];
  for (const [candidate, reasonCode] of cases) {
    const result = admitOrder(candidate, context(), new InMemoryIdempotencyStore());
    assert.equal(result.reasonCode, reasonCode);
  }
});

test("expired authorization is blocked", () => {
  const result = admitOrder(intent(), context({ nowMs: 2000 }), new InMemoryIdempotencyStore());
  assert.equal(result.reasonCode, OrderAdmissionReasonCode.AUTHORIZATION_EXPIRED);
});

test("pre-trade risk rejection is preserved by order admission", () => {
  const result = admitOrder(intent({ baseQtyRaw: 3n }), context(), new InMemoryIdempotencyStore());
  assert.equal(result.reasonCode, OrderAdmissionReasonCode.RISK_BLOCKED);
  assert.equal(result.riskReasonCode, RiskReasonCode.MAX_POSITION_QTY_EXCEEDED);
});

test("intent hash is deterministic and changes with material payload", () => {
  assert.equal(hashOrderIntent(intent()), hashOrderIntent(intent()));
  assert.notEqual(hashOrderIntent(intent()), hashOrderIntent(intent({ symbol: "ETH-USDT" })));
});

test("invalid quantity is rejected before storage mutation", () => {
  const store = new InMemoryIdempotencyStore();
  assert.throws(() => admitOrder(intent({ baseQtyRaw: 0n }), context(), store), /positive bigint/);
  assert.equal(store.getByKey("key-1"), undefined);
});
