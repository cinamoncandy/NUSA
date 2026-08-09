const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult
} = require("../dist/packages/contracts/src/personalPaperOrderCommand.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
const { submitPersonalPaperOrder } = require("../dist/apps/mobile/src/personalPaperOrderClient.js");
const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const {
  clearConfiguredPaperEndpoint,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

const command = (overrides = {}) => ({ schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, idempotencyKey: "paper-mobile-00000001", market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001, ...overrides });
const binding = (item = command()) => ({ idempotencyKey: item.idempotencyKey, market: item.market, side: item.side, orderType: item.orderType, quantity: item.quantity, ...(item.limitPrice === undefined ? {} : { limitPrice: item.limitPrice }) });
const NOW = 1_700_000_000_000;
const filledOrder = (overrides = {}) => ({ id: "paper-order-1", market: "KRW-BTC", side: "BUY", quantity: 0.001, price: 100_000_000, fee: 50, filledAt: new Date(NOW - 1_000).toISOString(), status: "FILLED", fills: [{ id: "paper-fill-1", quantity: 0.001, price: 100_000_000, filledAt: new Date(NOW - 1_000).toISOString() }], ...overrides });
const paperSnapshot = (order = filledOrder(), generatedAt = NOW) => buildPersonalPaperOperationsSnapshot({ dashboard: { apiVersion: "1", generatedAt, mode: "PAPER", overallHealth: "HEALTHY", killSwitchActive: false, tradingAllowed: true }, research: null, ai: null, operations: { runtimeState: "READY", schedulerRunning: false, schedulerMode: "OFF", pipelineStage: "IDLE", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, updatedAt: generatedAt }, orders: [order], markets: [] }, generatedAt);
const filledResult = (overrides = {}, submitted = command()) => { const order = filledOrder({ market: submitted.market, side: submitted.side, quantity: submitted.quantity }); return { schemaVersion: 1, status: "FILLED", ...binding(submitted), order, snapshot: paperSnapshot(order), liveAuthority: "NONE", productionMutationAllowed: false, ...overrides }; };
const blockedWireResult = (submitted = command(), overrides = {}) => ({ schemaVersion: 1, status: "BLOCKED", ...binding(submitted), reason: "TEST_BLOCK", liveAuthority: "NONE", productionMutationAllowed: false, ...overrides });

const clearMobileConnection = () => {
  clearConfiguredPaperEndpoint();
  new InMemoryDashboardCredentialSession().clear();
};

test.beforeEach(clearMobileConnection);
test.afterEach(clearMobileConnection);

test("PAPER order command hard-codes PAPER_ONLY and no production mutation", () => {
  const value = validatePersonalPaperOrderCommand(command());
  assert.equal(value.authority, "PAPER_ONLY"); assert.equal(value.productionMutationAllowed, false); assert.equal(value.market, "KRW-BTC");
  assert.throws(() => validatePersonalPaperOrderCommand(command({ authority: "LIVE" })), /authority/);
  assert.throws(() => validatePersonalPaperOrderCommand(command({ productionMutationAllowed: true })), /authority/);
});

test("idempotency key is header-safe and LIMIT orders require a positive limit price", () => {
  assert.throws(() => validatePersonalPaperOrderCommand(command({ idempotencyKey: "paper-mobile-0000\r\nX-Evil: 1" })), /idempotencyKey/);
  assert.throws(() => validatePersonalPaperOrderCommand(command({ idempotencyKey: "paper mobile 00000001" })), /idempotencyKey/);
  assert.throws(() => validatePersonalPaperOrderCommand(command({ orderType: "LIMIT" })), /limitPrice/);
  assert.equal(validatePersonalPaperOrderCommand(command({ orderType: "LIMIT", limitPrice: 1000 })).limitPrice, 1000);
});

test("FILLED result requires truthful command binding, order, and canonical snapshot", () => {
  const submitted = command();
  assert.throws(() => validatePersonalPaperOrderCommandResult({ schemaVersion: 1, status: "FILLED", ...binding(submitted), liveAuthority: "NONE", productionMutationAllowed: false }, submitted, NOW), /requires order and snapshot/);
  assert.throws(() => validatePersonalPaperOrderCommandResult({ schemaVersion: 1, status: "BLOCKED", ...binding(submitted), liveAuthority: "LIVE", productionMutationAllowed: false }, submitted, NOW), /authority/);
  const result = validatePersonalPaperOrderCommandResult(filledResult({}, submitted), submitted, NOW);
  assert.equal(result.status, "FILLED"); assert.equal(result.order.id, "paper-order-1"); assert.equal(result.snapshot.orders.length, 1); assert.equal(result.idempotencyKey, submitted.idempotencyKey);
});

test("result rejects foreign idempotency, market, side, and quantity bindings", () => {
  const submitted = command();
  for (const overrides of [{ idempotencyKey: "paper-mobile-00000002" }, { market: "KRW-ETH" }, { side: "SELL" }, { quantity: 0.002 }]) assert.throws(() => validatePersonalPaperOrderCommandResult(filledResult(overrides, submitted), submitted, NOW), /binding mismatch|submitted command/);
});

test("FILLED result rejects stale, malformed, or authority-invalid nested PAPER snapshots", () => {
  const submitted = command(); const valid = filledResult({}, submitted);
  assert.throws(() => validatePersonalPaperOrderCommandResult(valid, submitted, NOW + 15_001, 15_000), /stale/);
  const malformed = structuredClone(valid); malformed.snapshot.orders[0].price = -1; assert.throws(() => validatePersonalPaperOrderCommandResult(malformed, submitted, NOW), /invalid PAPER order value/);
  const authorityInvalid = structuredClone(valid); authorityInvalid.snapshot.liveAuthority = "LIVE"; assert.throws(() => validatePersonalPaperOrderCommandResult(authorityInvalid, submitted, NOW), /authority/);
});

test("FILLED result rejects malformed fill and standalone order mismatch", () => {
  const submitted = command(); const malformedFill = filledResult({}, submitted); malformedFill.order = { ...malformedFill.order, fills: [{ ...malformedFill.order.fills[0], quantity: -1 }] }; assert.throws(() => validatePersonalPaperOrderCommandResult(malformedFill, submitted, NOW), /fill projection/);
  const valid = filledResult({}, submitted); const mismatched = { ...valid, order: { ...valid.order, price: valid.order.price + 1 } }; assert.throws(() => validatePersonalPaperOrderCommandResult(mismatched, submitted, NOW), /does not match snapshot order/);
});

test("DUPLICATE result must carry prior truthful order plus canonical snapshot bound to submitted command", () => {
  const submitted = command(); const prior = filledOrder(); const snapshot = paperSnapshot(prior);
  const duplicate = validatePersonalPaperOrderCommandResult({ schemaVersion: 1, status: "DUPLICATE", ...binding(submitted), reason: submitted.idempotencyKey, order: prior, snapshot, liveAuthority: "NONE", productionMutationAllowed: false }, submitted, NOW);
  assert.equal(duplicate.status, "DUPLICATE"); assert.equal(duplicate.order.id, prior.id); assert.equal(duplicate.snapshot.orders[0].id, prior.id);
  assert.throws(() => validatePersonalPaperOrderCommandResult({ ...duplicate, snapshot: undefined }, submitted, NOW), /requires order and snapshot/);
  assert.throws(() => validatePersonalPaperOrderCommandResult({ ...duplicate, order: { ...prior, market: "KRW-ETH" } }, submitted, NOW), /snapshot order|submitted command/);
});

test("mobile client makes no request without dashboard credential", async () => {
  let calls = 0; const result = await submitPersonalPaperOrder({ baseUrl: "https://nusa.invalid", credentialProvider: async () => null, request: async () => { calls += 1; throw new Error("must not call"); } }, command());
  assert.equal(result.status, "NOT_CONFIGURED"); assert.equal(calls, 0);
});

test("mobile client refuses insecure non-loopback PAPER endpoint", async () => {
  let calls = 0; const result = await submitPersonalPaperOrder({ baseUrl: "http://192.168.1.5:41731", credentialProvider: async () => "1234567890123456", request: async () => { calls += 1; throw new Error("must not call"); } }, command());
  assert.equal(result.status, "NOT_CONFIGURED"); assert.equal(calls, 0);
});

test("mobile client treats historical localhost default as unconfigured unless explicitly saved", async () => {
  let calls = 0; const result = await submitPersonalPaperOrder({ baseUrl: "http://127.0.0.1:41731", credentialProvider: async () => "1234567890123456", request: async () => { calls += 1; throw new Error("must not call"); } }, command());
  assert.equal(result.status, "NOT_CONFIGURED"); assert.equal(calls, 0); assert.match(result.reason, /endpoint is not configured/i);
});

test("Settings connection state reaches a separate Trading PAPER client instance", async () => {
  const settingsSession = new InMemoryDashboardCredentialSession();
  const tradingSession = new InMemoryDashboardCredentialSession();
  const submitted = command();
  let observedUrl = "";
  let observedAuthorization = "";

  setConfiguredPaperEndpoint("https://paper.settings.test/");
  settingsSession.connect("settings-shared-token-0001");

  const result = await submitPersonalPaperOrder({
    baseUrl: "http://127.0.0.1:41731",
    credentialProvider: tradingSession.credentialProvider,
    request: async (url, init) => {
      observedUrl = String(url);
      observedAuthorization = String(init.headers.authorization);
      return {
        ok: true,
        status: 200,
        redirected: false,
        url: "https://paper.settings.test/api/paper-orders",
        json: async () => blockedWireResult(submitted)
      };
    }
  }, submitted);

  assert.equal(result.status, "READY");
  assert.equal(observedUrl, "https://paper.settings.test/api/paper-orders");
  assert.equal(observedAuthorization, "Bearer settings-shared-token-0001");
});

test("mobile client posts only to exact PAPER route with no redirects and bound authority", async () => {
  const submitted = command(); let observedUrl = ""; let observedInit;
  const result = await submitPersonalPaperOrder({ baseUrl: "https://paper.example.test/", credentialProvider: async () => "1234567890123456", request: async (url, init) => { observedUrl = String(url); observedInit = init; return { ok: true, status: 200, redirected: false, url: "https://paper.example.test/api/paper-orders", json: async () => blockedWireResult(submitted) }; } }, submitted);
  assert.equal(result.status, "READY"); assert.equal(observedUrl, "https://paper.example.test/api/paper-orders"); assert.equal(observedInit.method, "POST"); assert.equal(observedInit.redirect, "error"); assert.ok(observedInit.signal); assert.equal(observedInit.headers.authorization, "Bearer 1234567890123456"); assert.equal(observedInit.headers["idempotency-key"], submitted.idempotencyKey); const body = JSON.parse(observedInit.body); assert.equal(body.authority, "PAPER_ONLY"); assert.equal(body.productionMutationAllowed, false);
});

test("mobile client rejects redirected or changed final PAPER endpoint", async () => {
  const submitted = command();
  const redirected = await submitPersonalPaperOrder({ baseUrl: "https://paper.example.test", credentialProvider: async () => "1234567890123456", request: async () => ({ ok: true, status: 200, redirected: true, url: "https://other.example.test/api/paper-orders", json: async () => blockedWireResult(submitted) }) }, submitted); assert.equal(redirected.status, "UNAVAILABLE"); assert.match(redirected.reason, /redirect/i);
  const changed = await submitPersonalPaperOrder({ baseUrl: "https://paper.example.test", credentialProvider: async () => "1234567890123456", request: async () => ({ ok: true, status: 200, redirected: false, url: "https://paper.example.test/other", json: async () => blockedWireResult(submitted) }) }, submitted); assert.equal(changed.status, "UNAVAILABLE"); assert.match(changed.reason, /endpoint changed/i);
});

test("mobile client bounds PAPER POST duration and fails closed on timeout", async () => {
  const result = await submitPersonalPaperOrder({ baseUrl: "https://paper.example.test", credentialProvider: async () => "1234567890123456", timeoutMs: 1, request: async () => new Promise(() => {}) }, command()); assert.equal(result.status, "UNAVAILABLE"); assert.match(result.reason, /timed out/i);
});

test("exact duplicate manual PAPER order produces one side effect only", () => {
  const submitted = validatePersonalPaperOrderCommand(command({ quantity: 0.001 })); const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
  const context = { now: NOW, marketPrice: 100_000, observedAt: NOW, mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" };
  const first = loop.submitManualOrder(submitted, context); const second = loop.submitManualOrder(submitted, context);
  assert.equal(first.status, "FILLED"); assert.equal(second.status, "DUPLICATE"); assert.equal(loop.snapshot().orders.length, 1); assert.equal(loop.snapshot().fills.length, 1); assert.equal(loop.snapshot().processedIdempotencyKeys.filter((key) => key === submitted.idempotencyKey).length, 1);
});
