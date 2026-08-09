const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult
} = require("../dist/packages/contracts/src/personalPaperOrderCommand.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
const { submitPersonalPaperOrder } = require("../dist/apps/mobile/src/personalPaperOrderClient.js");

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

const NOW = 1_700_000_000_000;
const filledOrder = (overrides = {}) => ({
  id: "paper-order-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 0.001,
  price: 100_000_000,
  fee: 50,
  filledAt: new Date(NOW - 1_000).toISOString(),
  status: "FILLED",
  fills: [{
    id: "paper-fill-1",
    quantity: 0.001,
    price: 100_000_000,
    filledAt: new Date(NOW - 1_000).toISOString()
  }],
  ...overrides
});

const paperSnapshot = (order = filledOrder(), generatedAt = NOW) => buildPersonalPaperOperationsSnapshot({
  dashboard: {
    apiVersion: "1",
    generatedAt,
    mode: "PAPER",
    overallHealth: "HEALTHY",
    killSwitchActive: false,
    tradingAllowed: true
  },
  research: null,
  ai: null,
  operations: {
    runtimeState: "READY",
    schedulerRunning: false,
    schedulerMode: "OFF",
    pipelineStage: "IDLE",
    transport: "ONLINE",
    killSwitchActive: false,
    accountHalted: false,
    pendingWrites: 0,
    updatedAt: generatedAt
  },
  orders: [order],
  markets: []
}, generatedAt);

const filledResult = (overrides = {}) => {
  const order = filledOrder();
  return {
    schemaVersion: 1,
    status: "FILLED",
    order,
    snapshot: paperSnapshot(order),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    ...overrides
  };
};

test("PAPER order command hard-codes PAPER_ONLY and no production mutation", () => {
  const value = validatePersonalPaperOrderCommand(command());
  assert.equal(value.authority, "PAPER_ONLY");
  assert.equal(value.productionMutationAllowed, false);
  assert.equal(value.market, "KRW-BTC");
  assert.throws(() => validatePersonalPaperOrderCommand(command({ authority: "LIVE" })), /authority/);
  assert.throws(() => validatePersonalPaperOrderCommand(command({ productionMutationAllowed: true })), /authority/);
});

test("LIMIT orders require a positive limit price", () => {
  assert.throws(() => validatePersonalPaperOrderCommand(command({ orderType: "LIMIT" })), /limitPrice/);
  const value = validatePersonalPaperOrderCommand(command({ orderType: "LIMIT", limitPrice: 1000 }));
  assert.equal(value.limitPrice, 1000);
});

test("FILLED result requires a truthful PAPER order and canonical snapshot", () => {
  assert.throws(() => validatePersonalPaperOrderCommandResult({ schemaVersion: 1, status: "FILLED", liveAuthority: "NONE", productionMutationAllowed: false }, NOW), /requires order and snapshot/);
  assert.throws(() => validatePersonalPaperOrderCommandResult({ schemaVersion: 1, status: "BLOCKED", liveAuthority: "LIVE", productionMutationAllowed: false }, NOW), /authority/);

  const result = validatePersonalPaperOrderCommandResult(filledResult(), NOW);
  assert.equal(result.status, "FILLED");
  assert.equal(result.order.id, "paper-order-1");
  assert.equal(result.snapshot.orders.length, 1);
});

test("FILLED result rejects stale or malformed nested PAPER snapshots", () => {
  const valid = filledResult();
  assert.throws(() => validatePersonalPaperOrderCommandResult(valid, NOW + 15_001, 15_000), /stale/);

  const malformed = structuredClone(valid);
  malformed.snapshot.orders[0].price = -1;
  assert.throws(() => validatePersonalPaperOrderCommandResult(malformed, NOW), /invalid PAPER order value/);
});

test("FILLED result rejects standalone order that does not match canonical snapshot", () => {
  const valid = filledResult();
  const mismatched = { ...valid, order: { ...valid.order, price: valid.order.price + 1 } };
  assert.throws(() => validatePersonalPaperOrderCommandResult(mismatched, NOW), /does not match snapshot order/);
});

test("mobile client makes no request without dashboard credential", async () => {
  let calls = 0;
  const result = await submitPersonalPaperOrder({
    baseUrl: "https://nusa.invalid",
    credentialProvider: async () => null,
    request: async () => { calls += 1; throw new Error("must not call"); }
  }, command());
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("mobile client refuses insecure non-loopback PAPER endpoint", async () => {
  let calls = 0;
  const result = await submitPersonalPaperOrder({
    baseUrl: "http://192.168.1.5:41731",
    credentialProvider: async () => "1234567890123456",
    request: async () => { calls += 1; throw new Error("must not call"); }
  }, command());
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("mobile client posts only to the PAPER order route with explicit authority", async () => {
  let observedUrl = "";
  let observedInit;
  const result = await submitPersonalPaperOrder({
    baseUrl: "https://paper.example.test/",
    credentialProvider: async () => "1234567890123456",
    request: async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          status: "BLOCKED",
          reason: "TEST_BLOCK",
          liveAuthority: "NONE",
          productionMutationAllowed: false
        })
      };
    }
  }, command());
  assert.equal(result.status, "READY");
  assert.equal(observedUrl, "https://paper.example.test/api/paper-orders");
  assert.equal(observedInit.method, "POST");
  assert.equal(observedInit.headers.authorization, "Bearer 1234567890123456");
  assert.equal(observedInit.headers["idempotency-key"], "paper-mobile-00000001");
  const body = JSON.parse(observedInit.body);
  assert.equal(body.authority, "PAPER_ONLY");
  assert.equal(body.productionMutationAllowed, false);
});
