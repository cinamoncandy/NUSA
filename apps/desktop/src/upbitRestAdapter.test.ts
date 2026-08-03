import assert from "node:assert/strict";
import test from "node:test";
import {
  LiveMutationDisabledError,
  MockUpbitRestAdapter,
  UpbitApiError,
  UpbitConfigurationError,
  UpbitRestClient,
  createUpbitJwt,
  loadUpbitCredentials,
} from "./upbitRestAdapter";

function response(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

function decodeClaims(token: string): Record<string, string> {
  const encoded = token.replace(/^Bearer [^.]+\./, "").split(".")[0];
  return JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8")) as Record<string, string>;
}

test("JWT claims include a deterministic query hash without exposing the secret", () => {
  const token = createUpbitJwt({ accessKey: "access-key", secretKey: "secret-key" }, { nonce: "nonce-1", queryString: "market=KRW-BTC&state=wait" });
  const claims = decodeClaims(token);
  assert.equal(claims.access_key, "access-key");
  assert.equal(claims.nonce, "nonce-1");
  assert.equal(claims.query_hash_alg, "SHA512");
  assert.match(claims.query_hash ?? "", /^[a-f0-9]{128}$/);
  assert.equal(token.includes("secret-key"), false);
});

test("environment credentials require both keys and do not persist them", () => {
  assert.deepEqual(loadUpbitCredentials({ UPBIT_ACCESS_KEY: " a ", UPBIT_SECRET_KEY: " b " }), { accessKey: "a", secretKey: "b" });
  assert.throws(() => loadUpbitCredentials({ UPBIT_ACCESS_KEY: "a" }), UpbitConfigurationError);
});

test("REST client signs order chance requests and returns typed DTOs", async () => {
  let requested = "";
  const client = new UpbitRestClient({
    credentials: { accessKey: "access-key", secretKey: "secret-key" },
    nonce: () => "nonce-2",
    fetchImpl: async (input, init) => {
      requested = String(input);
      assert.equal(new Headers(init?.headers).has("authorization"), true);
      return response({ bid_fee: "0.0005", ask_fee: "0.0005", maker_bid_fee: "0.0005", maker_ask_fee: "0.0005", market: { id: "KRW-BTC", name: "Bitcoin", order_types: ["limit"], order_sides: ["bid"], bid: { currency: "KRW", min_total: "5000" }, ask: { currency: "BTC", min_total: "5000" } } });
    },
  });
  const chance = await client.getOrderChance("KRW-BTC");
  assert.equal(new URL(requested).pathname, "/v1/orders/chance");
  assert.equal(new URL(requested).searchParams.get("market"), "KRW-BTC");
  assert.equal(chance.market.bid.min_total, "5000");
});

test("429 and 5xx responses use bounded retry and map the final error", async () => {
  let attempts = 0;
  const waits: number[] = [];
  const client = new UpbitRestClient({
    credentials: { accessKey: "a", secretKey: "b" },
    retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 15 },
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    fetchImpl: async () => { attempts += 1; return response({ error: { name: "too_many_requests", message: "slow down" } }, 429, { "retry-after": "1" }); },
  });
  await assert.rejects(client.getAccounts(), (error: unknown) => error instanceof UpbitApiError && error.status === 429 && error.retryable === true);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1_000, 1_000]);
});

test("live mutation stays fail-closed while read adapter remains usable", async () => {
  const client = new UpbitRestClient({ credentials: { accessKey: "a", secretKey: "b" }, fetchImpl: async () => response([]) });
  assert.deepEqual(await client.getAccounts(), []);
  await assert.rejects(client.cancelOrder(), LiveMutationDisabledError);
  await assert.rejects(client.submitOrder(), LiveMutationDisabledError);
});

test("mock adapter provides deterministic account, order and chance fixtures", async () => {
  const mock = new MockUpbitRestAdapter({
    accounts: [{ currency: "KRW", balance: "100000", locked: "0", avg_buy_price: "0", avg_buy_price_modified: false, unit_currency: "KRW" }],
    orders: [{ uuid: "order-1", side: "bid", ord_type: "limit", price: "100", state: "wait", market: "KRW-BTC", created_at: "2026-01-01T00:00:00Z", volume: "1", remaining_volume: "1", reserved_fee: "0", remaining_fee: "0", paid_fee: "0", locked: "100", executed_volume: "0", trades_count: 0 }],
  });
  assert.equal((await mock.getAccounts())[0]?.currency, "KRW");
  assert.equal((await mock.getOpenOrders("KRW-BTC"))[0]?.uuid, "order-1");
  assert.equal((await mock.getOrderChance("KRW-BTC")).market.id, "KRW-BTC");
  await assert.rejects(mock.getOrder("missing"), /order not found/);
});
