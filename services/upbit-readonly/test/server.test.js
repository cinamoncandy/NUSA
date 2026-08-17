"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  LOOPBACK_HOST,
  UPBIT_ACCOUNTS_URL,
  ACCOUNT_SUMMARY_PATH,
  LEGACY_ACCOUNTS_PATH,
  createUpbitJwt,
  loadUpbitAccounts,
  normalizeUpbitAccountSummary,
  safeTokenMatch,
} = require("../server");

const env = { UPBIT_ACCESS_KEY: "access-key", UPBIT_SECRET_KEY: "secret-key" };

test("server binding is loopback-only", () => {
  assert.equal(LOOPBACK_HOST, "127.0.0.1");
});

test("bridge bearer comparison accepts only the exact token", () => {
  assert.equal(safeTokenMatch("Bearer bridge-token", "bridge-token"), true);
  assert.equal(safeTokenMatch("Bearer wrong-token", "bridge-token"), false);
  assert.equal(safeTokenMatch(undefined, "bridge-token"), false);
});

test("Upbit JWT is HS512 and contains access_key plus nonce", () => {
  const token = createUpbitJwt("access-key", "secret-key");
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "HS512", typ: "JWT" });
  assert.equal(payload.access_key, "access-key");
  assert.equal(typeof payload.nonce, "string");
  assert.ok(signaturePart.length > 0);
});

test("accounts loader performs GET against the read-only Upbit endpoint", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, json: async () => [{ currency: "KRW", balance: "1000", locked: "0" }] };
  };
  const accounts = await loadUpbitAccounts({ env, fetchImpl });
  assert.equal(captured.url, UPBIT_ACCOUNTS_URL);
  assert.equal(captured.options.method, "GET");
  assert.match(captured.options.headers.authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.equal(accounts[0].currency, "KRW");
});

test("accounts loader rejects malformed provider payloads", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ currency: "KRW" }) });
  await assert.rejects(loadUpbitAccounts({ env, fetchImpl }), /not an array/);
});

test("summary normalization aggregates KRW and separates assets", () => {
  const summary = normalizeUpbitAccountSummary([
    { currency: "KRW", balance: "1000", locked: "25", avg_buy_price: "0", unit_currency: "KRW" },
    { currency: "KRW", balance: 500, locked: 0, avg_buy_price: 0, unit_currency: "KRW" },
    { currency: "BTC", balance: "0.25", locked: "0.01", avg_buy_price: "90000000", unit_currency: "KRW" },
    { currency: "ETH", balance: "2", locked: "0", avg_buy_price: "4000000", unit_currency: "KRW" },
  ], { now: Date.parse("2026-08-15T00:00:00.000Z") });
  assert.deepEqual(summary, {
    provider: "UPBIT",
    mode: "READ_ONLY",
    fetchedAt: "2026-08-15T00:00:00.000Z",
    cash: { currency: "KRW", available: 1500, locked: 25 },
    assets: [
      { currency: "BTC", available: 0.25, locked: 0.01, avgBuyPrice: 90000000, unitCurrency: "KRW" },
      { currency: "ETH", available: 2, locked: 0, avgBuyPrice: 4000000, unitCurrency: "KRW" },
    ],
  });
});

test("summary normalization handles empty and zero balances", () => {
  assert.deepEqual(normalizeUpbitAccountSummary([], { now: 1 }).cash, { currency: "KRW", available: 0, locked: 0 });
  assert.deepEqual(normalizeUpbitAccountSummary([
    { currency: "KRW", balance: "0", locked: "0", unit_currency: "KRW" },
  ], { now: 1 }).assets, []);
});

test("summary normalization rejects malformed, negative, nonfinite, and invalid currency data", () => {
  for (const payload of [
    [{ currency: "KRW", balance: "-1", locked: "0", unit_currency: "KRW" }],
    [{ currency: "KRW", balance: "NaN", locked: "0", unit_currency: "KRW" }],
    [{ currency: "bad currency", balance: "1", locked: "0", unit_currency: "KRW" }],
    [{ currency: "BTC", balance: "1", locked: "0", unit_currency: "" }],
    [{ currency: "BTC", balance: {}, locked: "0", unit_currency: "KRW" }],
  ]) {
    assert.throws(() => normalizeUpbitAccountSummary(payload, { now: 1 }), /Invalid Upbit/);
  }
});

test("canonical summary endpoint returns stable normalized data and does not expose secrets", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => [
        { currency: "KRW", balance: "1000", locked: "5", unit_currency: "KRW" },
        { currency: "BTC", balance: "0.1", locked: "0", avg_buy_price: "80000000", unit_currency: "KRW" },
      ],
    };
  };
  const handler = require("../server").createRequestHandler({
    env: { ...env, NUSA_API_TOKEN: "bridge-token" },
    fetchImpl,
    now: () => Date.parse("2026-08-15T00:00:00.000Z"),
  });
  const response = {
    statusCode: 0,
    headers: {},
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  await handler({ method: "GET", url: ACCOUNT_SUMMARY_PATH, headers: { authorization: "Bearer bridge-token" } }, response);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.provider, "UPBIT");
  assert.equal(body.mode, "READ_ONLY");
  assert.equal(body.cash.available, 1000);
  assert.equal(body.assets[0].currency, "BTC");
  assert.equal(captured.url, UPBIT_ACCOUNTS_URL);
  assert.equal(captured.options.method, "GET");
  assert.equal(JSON.stringify(body).includes("secret-key"), false);
});

test("legacy accounts endpoint remains a normalized compatibility path", async () => {
  const handler = require("../server").createRequestHandler({
    env: { ...env, NUSA_API_TOKEN: "bridge-token" },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
    now: () => 1,
  });
  const response = {
    statusCode: 0,
    writeHead(status) { this.statusCode = status; },
    end(body) { this.body = body; },
  };
  await handler({ method: "GET", url: LEGACY_ACCOUNTS_PATH, headers: { authorization: "Bearer bridge-token" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).mode, "READ_ONLY");
});

test("summary endpoint rejects unauthorized and non-GET requests", async () => {
  const handler = require("../server").createRequestHandler({
    env: { ...env, NUSA_API_TOKEN: "bridge-token" },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
  });
  const response = () => ({
    statusCode: 0,
    writeHead(status) { this.statusCode = status; },
    end(body) { this.body = body; },
  });
  const unauthorized = response();
  await handler({ method: "GET", url: ACCOUNT_SUMMARY_PATH, headers: { authorization: "Bearer wrong" } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  const method = response();
  await handler({ method: "POST", url: ACCOUNT_SUMMARY_PATH, headers: { authorization: "Bearer bridge-token" } }, method);
  assert.equal(method.statusCode, 405);
});

test("provider failures return generic upstream errors", async () => {
  const handler = require("../server").createRequestHandler({
    env: { ...env, NUSA_API_TOKEN: "bridge-token" },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ secret: "do-not-return" }) }),
  });
  const response = { statusCode: 0, writeHead(status) { this.statusCode = status; }, end(body) { this.body = body; } };
  await handler({ method: "GET", url: ACCOUNT_SUMMARY_PATH, headers: { authorization: "Bearer bridge-token" } }, response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.includes("do-not-return"), false);
  assert.equal(response.body.includes("401"), false);
});


const orderServer = require("../server");

const orderFixture = {
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  market: "KRW-BTC",
  side: "bid",
  ord_type: "limit",
  price: "90000000",
  volume: "0.01",
  executed_volume: "0.004",
  remaining_volume: "0.006",
  state: "wait",
  created_at: "2026-08-15T00:00:00+09:00",
};

test("read-only order normalization maps standard fields and partial state", () => {
  assert.deepEqual(orderServer.normalizeUpbitOrder(orderFixture), {
    uuid: orderFixture.uuid,
    market: "KRW-BTC",
    side: "BUY",
    ordType: "LIMIT",
    price: 90000000,
    volume: 0.01,
    executedVolume: 0.004,
    remainingVolume: 0.006,
    state: "PARTIAL",
    createdAt: "2026-08-14T15:00:00.000Z",
  });
});

test("read-only order normalization maps done and cancelled states", () => {
  assert.equal(orderServer.normalizeUpbitOrder({
    ...orderFixture,
    side: "ask",
    ord_type: "market",
    price: null,
    executed_volume: "0.01",
    remaining_volume: "0",
    state: "done",
  }).state, "DONE");
  assert.equal(orderServer.normalizeUpbitOrder({
    ...orderFixture,
    state: "cancel",
    executed_volume: "0",
    remaining_volume: "0.01",
  }).state, "CANCELLED");
});

test("read-only order loader uses GET and query-hashed credentials", async () => {
  const captured = [];
  const orders = await orderServer.loadUpbitOrders({
    env,
    scope: "open",
    fetchImpl: async (url, options) => {
      captured.push({ url, options });
      return { ok: true, status: 200, json: async () => [orderFixture] };
    },
  });
  assert.equal(orders[0].state, "PARTIAL");
  assert.match(captured[0].url, /https:\/\/api\.upbit\.com\/v1\/orders\/open\?states%5B%5D=wait&states%5B%5D=watch/);
  assert.equal(captured[0].options.method, "GET");
  const tokenPayload = JSON.parse(Buffer.from(captured[0].options.headers.authorization.split(".")[1], "base64url").toString("utf8"));
  assert.equal(tokenPayload.query_hash_alg, "SHA512");
  assert.equal(tokenPayload.query_hash, createHash("sha512").update("states[]=wait&states[]=watch").digest("hex"));
});

test("read-only order detail validates UUID before upstream access", async () => {
  let called = false;
  await assert.rejects(
    orderServer.loadUpbitOrders({
      env,
      scope: "detail",
      uuid: "bad",
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, json: async () => orderFixture };
      },
    }),
    /Invalid Upbit order uuid/,
  );
  assert.equal(called, false);
});

test("read-only order handler exposes open, history, and detail GET routes only", async () => {
  const handler = orderServer.createRequestHandler({
    env: { ...env, NUSA_API_TOKEN: "bridge-token" },
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      json: async () => url.includes("/v1/order?") ? orderFixture : [orderFixture],
    }),
  });
  const makeResponse = () => ({
    statusCode: 0,
    writeHead(status) { this.statusCode = status; },
    end(body) { this.body = body; },
  });
  for (const pathname of [orderServer.ORDERS_OPEN_PATH, orderServer.ORDERS_HISTORY_PATH, orderServer.ORDER_DETAIL_PREFIX + orderFixture.uuid]) {
    const response = makeResponse();
    await handler({ method: "GET", url: pathname, headers: { authorization: "Bearer bridge-token" } }, response);
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(pathname.endsWith(orderFixture.uuid) ? body.state : body[0].state, "PARTIAL");
  }
  const invalid = makeResponse();
  await handler({ method: "GET", url: orderServer.ORDER_DETAIL_PREFIX + "bad", headers: { authorization: "Bearer bridge-token" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const post = makeResponse();
  await handler({ method: "POST", url: orderServer.ORDERS_OPEN_PATH, headers: { authorization: "Bearer bridge-token" } }, post);
  assert.equal(post.statusCode, 405);
});
