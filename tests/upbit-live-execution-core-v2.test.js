const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { LiveMutationDisabledError } = require("../dist/apps/desktop/src/exchange/upbitRestAdapter.js");
const { UpbitExecutionRestClient } = require("../dist/apps/desktop/src/exchange/upbitExecutionRestClient.js");
const { createTradingAdapter, createLiveOrderExecutionAdapter, LiveAdapterSelectionError } = require("../dist/apps/desktop/src/exchange/liveTradingAdapter.js");

const credentials = { accessKey: "access-key", secretKey: "secret-key" };
function orderFixture() { return { uuid: "order-1", side: "bid", ord_type: "limit", price: "100000000", state: "wait", market: "KRW-BTC", created_at: "2026-08-20T00:00:00+09:00", volume: "0.0001", remaining_volume: "0.0001", reserved_fee: "0", remaining_fee: "0", paid_fee: "0", locked: "10000", executed_volume: "0", trades_count: 0 }; }
function jsonResponse(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }); }
function decodeJwt(authorization) { const [headerPart, payloadPart] = authorization.slice("Bearer ".length).split("."); return { header: JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")), payload: JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) }; }

test("authenticated Upbit order preflight uses HS512 and raw query hashing", async () => {
  const calls = [];
  const client = new UpbitExecutionRestClient({ credentials, nonce: () => "fixed-nonce", fetchImpl: async (url, init) => { calls.push({ url, init }); return jsonResponse(orderFixture()); } });
  await client.testOrder({ market: "KRW-BTC", side: "bid", ord_type: "limit", volume: "0.0001", price: "100000000", identifier: "nusa live test/한글" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.upbit.com/v1/orders/test");
  assert.equal(calls[0].init.method, "POST");
  const { header, payload } = decodeJwt(calls[0].init.headers.Authorization);
  assert.equal(header.alg, "HS512");
  const raw = "market=KRW-BTC&side=bid&ord_type=limit&volume=0.0001&price=100000000&identifier=nusa live test/한글";
  assert.equal(payload.query_hash_alg, "SHA512");
  assert.equal(payload.query_hash, createHash("sha512").update(raw, "utf8").digest("hex"));
});

test("default bundle contains no real order or cancel transport", async () => {
  let calls = 0;
  const client = new UpbitExecutionRestClient({ credentials, fetchImpl: async () => { calls += 1; return jsonResponse(orderFixture()); } });
  const order = { market: "KRW-BTC", side: "bid", ord_type: "price", price: "10000" };
  await assert.rejects(client.submitOrder(order), LiveMutationDisabledError);
  await assert.rejects(client.cancelOrder("order-1"), LiveMutationDisabledError);
  await assert.rejects(client.withdraw(), LiveMutationDisabledError);
  assert.equal(calls, 0);
});

test("default LIVE adapter stays read-only and environment flags alone cannot create execution", () => {
  const readOnly = createTradingAdapter({ NUSA_TRADING_ADAPTER_MODE: "LIVE", NUSA_ENABLE_LIVE_ADAPTER: "true", UPBIT_ACCESS_KEY: "a", UPBIT_SECRET_KEY: "b" });
  assert.equal(readOnly.readOnly, true);
  assert.equal(readOnly.productionMutationAllowed, false);
  assert.throws(() => createLiveOrderExecutionAdapter({ NUSA_TRADING_ADAPTER_MODE: "LIVE", NUSA_ENABLE_LIVE_ADAPTER: "true", NUSA_ENABLE_LIVE_ORDER_MUTATION: "true", UPBIT_ACCESS_KEY: "a", UPBIT_SECRET_KEY: "b" }), /explicitly injected Restricted-LIVE transport/);
  assert.throws(() => createLiveOrderExecutionAdapter({ NUSA_TRADING_ADAPTER_MODE: "LIVE", NUSA_ENABLE_LIVE_ADAPTER: "true", UPBIT_ACCESS_KEY: "a", UPBIT_SECRET_KEY: "b" }), LiveAdapterSelectionError);
});

test("injected restricted-live transport still requires per-order authority", async () => {
  const delegated = [];
  const fixture = orderFixture();
  const orderAdapter = {
    async getAccounts() { return []; }, async getOrders() { return []; }, async getOpenOrders() { return []; }, async getOrder() { return fixture; },
    async getOrderChance() { return { bid_fee: "0.0005", ask_fee: "0.0005", maker_bid_fee: "0.0005", maker_ask_fee: "0.0005", market: { id: "KRW-BTC", name: "BTC", order_types: ["limit"], order_sides: ["bid", "ask"], bid: { currency: "KRW", min_total: "5000" }, ask: { currency: "BTC", min_total: "5000" } } }; },
    async captureSnapshot() { return { observedAt: new Date(0).toISOString(), accounts: [], openOrders: [] }; },
    async testOrder(order) { delegated.push(["test", order]); return fixture; },
    async submitOrder(order) { delegated.push(["submit", order]); return fixture; },
    async cancelOrder(uuid) { delegated.push(["cancel", uuid]); return fixture; },
    async withdraw() { throw new LiveMutationDisabledError("withdraw"); },
  };
  const adapter = createLiveOrderExecutionAdapter({ NUSA_TRADING_ADAPTER_MODE: "LIVE", NUSA_ENABLE_LIVE_ADAPTER: "true", NUSA_ENABLE_LIVE_ORDER_MUTATION: "true" }, { liveOrderAdapter: orderAdapter });
  const order = { market: "KRW-BTC", side: "bid", ord_type: "price", price: "10000" };
  await adapter.testOrder(order);
  assert.throws(() => adapter.submitOrder(order, { productionMutationAllowed: false, confirmation: "NO" }), LiveMutationDisabledError);
  assert.equal(delegated.length, 1);
  const authority = { productionMutationAllowed: true, confirmation: "CONFIRM_UPBIT_LIVE_ORDER" };
  await adapter.submitOrder(order, authority);
  await adapter.cancelOrder("order-1", authority);
  assert.deepEqual(delegated.map(([kind]) => kind), ["test", "submit", "cancel"]);
});
