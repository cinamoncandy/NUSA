const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult
} = require("../dist/packages/contracts/src/personalPaperOrderCommand.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");

const NOW = 1_700_000_000_000;
const command = (overrides = {}) => ({
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey: "paper-mobile-00000001",
  market: "KRW-BTC",
  side: "BUY",
  orderType: "MARKET",
  quantity: 0.001,
  ...overrides
});
const binding = (item) => ({
  idempotencyKey: item.idempotencyKey,
  market: item.market,
  side: item.side,
  orderType: item.orderType,
  quantity: item.quantity,
  ...(item.limitPrice === undefined ? {} : { limitPrice: item.limitPrice })
});
const filledOrder = () => ({
  id: "paper-order-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 0.001,
  price: 100_000_000,
  fee: 50,
  filledAt: new Date(NOW - 1_000).toISOString(),
  status: "FILLED",
  fills: [{ id: "paper-fill-1", quantity: 0.001, price: 100_000_000, filledAt: new Date(NOW - 1_000).toISOString() }]
});
const snapshot = (order) => buildPersonalPaperOperationsSnapshot({
  dashboard: { apiVersion: "1", generatedAt: NOW, mode: "PAPER", overallHealth: "HEALTHY", killSwitchActive: false, tradingAllowed: true },
  research: null,
  ai: null,
  operations: { runtimeState: "READY", schedulerRunning: false, schedulerMode: "OFF", pipelineStage: "IDLE", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, updatedAt: NOW },
  orders: [order],
  markets: []
}, NOW);

test("PAPER command preserves zero-LIVE authority invariants", () => {
  const value = validatePersonalPaperOrderCommand(command());
  assert.equal(value.authority, "PAPER_ONLY");
  assert.equal(value.productionMutationAllowed, false);
  assert.throws(() => validatePersonalPaperOrderCommand(command({ authority: "LIVE" })), /authority/);
  assert.throws(() => validatePersonalPaperOrderCommand(command({ productionMutationAllowed: true })), /authority/);
});

test("PAPER command validates idempotency and LIMIT price", () => {
  assert.throws(() => validatePersonalPaperOrderCommand(command({ idempotencyKey: "bad key" })), /idempotencyKey/);
  assert.throws(() => validatePersonalPaperOrderCommand(command({ orderType: "LIMIT" })), /limitPrice/);
  assert.equal(validatePersonalPaperOrderCommand(command({ orderType: "LIMIT", limitPrice: 1000 })).limitPrice, 1000);
});

test("FILLED result requires truthful binding, order, snapshot, and NONE live authority", () => {
  const submitted = validatePersonalPaperOrderCommand(command());
  const order = filledOrder();
  const result = validatePersonalPaperOrderCommandResult({
    schemaVersion: 1,
    status: "FILLED",
    ...binding(submitted),
    order,
    snapshot: snapshot(order),
    liveAuthority: "NONE",
    productionMutationAllowed: false
  }, submitted, NOW);
  assert.equal(result.status, "FILLED");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.throws(() => validatePersonalPaperOrderCommandResult({ ...result, liveAuthority: "LIVE" }, submitted, NOW), /authority/);
  assert.throws(() => validatePersonalPaperOrderCommandResult({ ...result, idempotencyKey: "paper-mobile-00000002" }, submitted, NOW), /binding mismatch/);
});

test("DUPLICATE result also requires canonical prior order plus snapshot", () => {
  const submitted = validatePersonalPaperOrderCommand(command());
  const order = filledOrder();
  const duplicate = {
    schemaVersion: 1,
    status: "DUPLICATE",
    ...binding(submitted),
    reason: submitted.idempotencyKey,
    order,
    snapshot: snapshot(order),
    liveAuthority: "NONE",
    productionMutationAllowed: false
  };
  assert.equal(validatePersonalPaperOrderCommandResult(duplicate, submitted, NOW).status, "DUPLICATE");
  assert.throws(() => validatePersonalPaperOrderCommandResult({ ...duplicate, snapshot: undefined }, submitted, NOW), /requires order and snapshot/);
});
