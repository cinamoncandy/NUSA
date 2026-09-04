const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LiveMutationDisabledError,
  UpbitApiError,
  UpbitConfigurationError,
  UpbitTransportError,
} = require("../dist/apps/desktop/src/exchange/upbitRestAdapter.js");
const { UpbitExecutionRestClient } = require("../dist/apps/desktop/src/exchange/upbitExecutionRestClient.js");

const credentials = { accessKey: "access-key", secretKey: "secret-key" };

function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!route) throw new Error(`unexpected url ${url}`);
    const [, respond] = route;
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

test("constructor rejects blank credentials and trims the base URL", () => {
  assert.throws(() => new UpbitExecutionRestClient({ credentials: { accessKey: "  ", secretKey: "x" } }), UpbitConfigurationError);
  assert.throws(() => new UpbitExecutionRestClient({ credentials: { accessKey: "x", secretKey: "" } }), UpbitConfigurationError);
  const calls = [];
  const client = new UpbitExecutionRestClient({
    credentials,
    baseUrl: "https://proxy.example.test/",
    fetchImpl: async (url) => { calls.push(url); return jsonResponse([]); },
  });
  return client.getAccounts().then(() => {
    assert.equal(calls[0], "https://proxy.example.test/v1/accounts");
  });
});

test("order query validation rejects non-positive paging", async () => {
  const client = new UpbitExecutionRestClient({ credentials, fetchImpl: async () => jsonResponse([]) });
  await assert.rejects(client.getOrders({ page: 0 }), /page must be a positive integer/);
  await assert.rejects(client.getOrders({ limit: -1 }), /limit must be a positive integer/);
  await assert.rejects(client.getOrder("   "), /Order UUID is required/);
  await assert.rejects(client.getOrderChance(""), /Market is required/);
});

test("order queries encode market filters into the URL", async () => {
  const { calls, fetchImpl } = stubFetch({ "https://api.upbit.com": async () => jsonResponse([]) });
  const client = new UpbitExecutionRestClient({ credentials, fetchImpl });
  await client.getOpenOrders("KRW-BTC");
  assert.ok(calls[0].url.includes("/v1/orders?"));
  assert.ok(calls[0].url.includes("market=KRW-BTC"));
  assert.ok(calls[0].url.includes("state=wait"));
});

test("captureSnapshot merges accounts with open orders and freezes the result", async () => {
  const accounts = [{ currency: "KRW", balance: "1000000" }];
  const orders = [{ uuid: "order-1" }];
  const { fetchImpl } = stubFetch({
    "https://api.upbit.com/v1/accounts": async () => jsonResponse(accounts),
    "https://api.upbit.com/v1/orders": async () => jsonResponse(orders),
  });
  const client = new UpbitExecutionRestClient({ credentials, fetchImpl });
  const snapshot = await client.captureSnapshot("KRW-BTC");
  assert.deepEqual(snapshot.accounts, accounts);
  assert.deepEqual(snapshot.openOrders, orders);
  assert.ok(Object.isFrozen(snapshot));
  assert.match(snapshot.observedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("transport failures and error payloads map to typed errors", async () => {
  const transport = new UpbitExecutionRestClient({
    credentials,
    fetchImpl: async () => { throw new Error("socket hangup"); },
  });
  await assert.rejects(transport.getAccounts(), UpbitTransportError);
  const rateLimited = new UpbitExecutionRestClient({
    credentials,
    fetchImpl: async () => jsonResponse({ error: { name: "too_many_request", message: "slow down" } }, 429, { "retry-after": "2" }),
  });
  const rateError = await rateLimited.getAccounts().catch((error) => error);
  assert.ok(rateError instanceof UpbitApiError);
  assert.equal(rateError.status, 429);
  assert.equal(rateError.retryAfterMs, 2000);
  const invalidJson = new UpbitExecutionRestClient({
    credentials,
    fetchImpl: async () => new Response("not-json{{{", { status: 200 }),
  });
  await assert.rejects(invalidJson.getAccounts(), /invalid JSON/);
});

test("order normalization rejects malformed order shapes", async () => {
  const client = new UpbitExecutionRestClient({ credentials, fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(client.testOrder({ market: "krwbtc", side: "bid", ord_type: "limit", volume: "1", price: "100" }), /quote-base format/);
  await assert.rejects(client.testOrder({ market: "KRW-BTC", side: "bid", ord_type: "limit", volume: "1" }), /limit order requires volume and price/);
  await assert.rejects(client.testOrder({ market: "KRW-BTC", side: "ask", ord_type: "price", price: "100" }), /market buy/);
  await assert.rejects(client.testOrder({ market: "KRW-BTC", side: "bid", ord_type: "market", volume: "1", price: "100" }), /market sell/);
  await assert.rejects(client.testOrder({ market: "KRW-BTC", side: "bid", ord_type: "best" }), /volume or price/);
  await assert.rejects(
    client.testOrder({ market: "KRW-BTC", side: "bid", ord_type: "limit", volume: "1", price: "100", time_in_force: "post_only", smp_type: "reduce" }),
    /post_only cannot be combined/
  );
  await assert.rejects(client.submitOrder({ market: "KRW-BTC", side: "bid", ord_type: "limit", volume: "1", price: "100" }), LiveMutationDisabledError);
});
