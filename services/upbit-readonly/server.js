"use strict";

const crypto = require("node:crypto");
const http = require("node:http");

const DEFAULT_PORT = 3001;
const PORT_ENV = "NUSA_UPBIT_READONLY_PORT";
const LOOPBACK_HOST = "127.0.0.1";
const UPBIT_ACCOUNTS_URL = "https://api.upbit.com/v1/accounts";
const ACCOUNT_SUMMARY_PATH = "/api/v1/account/summary";
const LEGACY_ACCOUNTS_PATH = "/api/upbit/accounts";
const ORDERS_OPEN_URL = "https://api.upbit.com/v1/orders/open";
const ORDERS_HISTORY_URL = "https://api.upbit.com/v1/orders";
const ORDER_URL = "https://api.upbit.com/v1/order";
const ORDERS_OPEN_PATH = "/api/v1/orders/open";
const ORDERS_HISTORY_PATH = "/api/v1/orders/history";
const ORDER_DETAIL_PREFIX = "/api/v1/orders/";
const UPSTREAM_TIMEOUT_MS = 10_000;

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createUpbitJwt(accessKey, secretKey, query = "") {
  const header = encodeJson({ alg: "HS512", typ: "JWT" });
  const payloadData = { access_key: accessKey, nonce: crypto.randomUUID() };
  if (query) {
    payloadData.query_hash = crypto.createHash("sha512").update(query).digest("hex");
    payloadData.query_hash_alg = "SHA512";
  }
  const payload = encodeJson(payloadData);
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac("sha512", secretKey).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function requiredEnv(env, name) {
  const value = typeof env[name] === "string" ? env[name].trim() : "";
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeTokenMatch(authorization, expectedToken) {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function loadUpbitAccounts({ env, fetchImpl }) {
  const accessKey = requiredEnv(env, "UPBIT_ACCESS_KEY");
  const secretKey = requiredEnv(env, "UPBIT_SECRET_KEY");
  const jwt = createUpbitJwt(accessKey, secretKey);
  const upstream = await fetchImpl(UPBIT_ACCOUNTS_URL, {
    method: "GET",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!upstream.ok) throw new Error(`Upbit accounts request failed with status ${upstream.status}`);
  const payload = await upstream.json();
  if (!Array.isArray(payload)) throw new Error("Upbit accounts response was not an array");
  return payload;
}

function finiteNumber(value, field) {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Invalid Upbit " + field);
  return parsed;
}

function currencyCode(value, field) {
  if (typeof value !== "string" || !/^[A-Z0-9]{2,12}$/.test(value.trim().toUpperCase())) {
    throw new Error("Invalid Upbit " + field);
  }
  return value.trim().toUpperCase();
}

function normalizeUpbitAccount(row) {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Invalid Upbit account");
  }
  const record = row;
  return Object.freeze({
    currency: currencyCode(record.currency, "currency"),
    available: finiteNumber(record.balance, "balance"),
    locked: finiteNumber(record.locked, "locked"),
    avgBuyPrice: finiteNumber(record.avg_buy_price ?? 0, "average buy price"),
    unitCurrency: currencyCode(record.unit_currency ?? "KRW", "unit currency"),
  });
}

function normalizeUpbitAccountSummary(payload, { now = Date.now() } = {}) {
  if (!Array.isArray(payload)) throw new Error("Invalid Upbit accounts response");
  if (!Number.isFinite(now)) throw new Error("Invalid summary timestamp");

  let available = 0;
  let locked = 0;
  const assets = [];
  for (const row of payload) {
    const item = normalizeUpbitAccount(row);
    if (item.currency === "KRW") {
      available += item.available;
      locked += item.locked;
    } else {
      assets.push({
        currency: item.currency,
        available: item.available,
        locked: item.locked,
        avgBuyPrice: item.avgBuyPrice,
        unitCurrency: item.unitCurrency,
      });
    }
  }

  return Object.freeze({
    provider: "UPBIT",
    mode: "READ_ONLY",
    fetchedAt: new Date(now).toISOString(),
    cash: Object.freeze({ currency: "KRW", available, locked }),
    assets: Object.freeze(assets.map((asset) => Object.freeze(asset))),
  });
}

async function loadUpbitAccountSummary({ env, fetchImpl, now = Date.now() }) {
  const accounts = await loadUpbitAccounts({ env, fetchImpl });
  return normalizeUpbitAccountSummary(accounts, { now });
}

function optionalNumber(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return finiteNumber(value, field);
}

function orderUuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{20,64}$/i.test(value)) {
    throw new Error("Invalid Upbit order uuid");
  }
  return value;
}

function orderMarket(value) {
  if (typeof value !== "string" || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(value.trim().toUpperCase())) {
    throw new Error("Invalid Upbit order market");
  }
  return value.trim().toUpperCase();
}

function normalizeUpbitOrder(row) {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Invalid Upbit order");
  }
  const record = row;
  const uuid = orderUuid(record.uuid);
  const rawSide = typeof record.side === "string" ? record.side.trim().toLowerCase() : "";
  const rawType = typeof record.ord_type === "string" ? record.ord_type.trim().toLowerCase() : "";
  const rawState = typeof record.state === "string" ? record.state.trim().toLowerCase() : "";
  const side = rawSide === "bid" ? "BUY" : rawSide === "ask" ? "SELL" : null;
  const ordType = rawType === "limit" ? "LIMIT" : rawType === "market" ? "MARKET" : rawType === "price" ? "MARKET" : rawType === "best" ? "BEST" : null;
  if (!side || !ordType) throw new Error("Invalid Upbit order side or type");
  const volume = finiteNumber(record.volume, "order volume");
  const executedVolume = finiteNumber(record.executed_volume ?? 0, "executed volume");
  if (executedVolume > volume) throw new Error("Invalid Upbit executed volume");
  const remainingVolume = finiteNumber(record.remaining_volume ?? (volume - executedVolume), "remaining volume");
  if (remainingVolume > volume || executedVolume + remainingVolume > volume) {
    throw new Error("Invalid Upbit order volume reconciliation");
  }
  const price = optionalNumber(record.price, "order price");
  const rawStatus = rawState === "wait" || rawState === "watch"
    ? (executedVolume > 0 ? "PARTIAL" : "OPEN")
    : rawState === "done" ? "DONE"
      : rawState === "cancel" ? "CANCELLED"
        : rawState === "reject" ? "REJECTED" : null;
  if (!rawStatus) throw new Error("Invalid Upbit order state");
  if (typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at))) {
    throw new Error("Invalid Upbit order timestamp");
  }
  return Object.freeze({
    uuid,
    market: orderMarket(record.market),
    side,
    ordType,
    price,
    volume,
    executedVolume,
    remainingVolume,
    state: rawStatus,
    createdAt: new Date(record.created_at).toISOString(),
  });
}

async function loadUpbitOrders({ env, fetchImpl, scope = "open", uuid }) {
  const accessKey = requiredEnv(env, "UPBIT_ACCESS_KEY");
  const secretKey = requiredEnv(env, "UPBIT_SECRET_KEY");
  let url;
  let query = "";
  if (scope === "open") {
    url = ORDERS_OPEN_URL;
    query = "states%5B%5D=wait&states%5B%5D=watch";
  } else if (scope === "history") {
    url = ORDERS_HISTORY_URL;
    query = "state=done&limit=100";
  } else if (scope === "detail") {
    url = ORDER_URL;
    query = "uuid=" + encodeURIComponent(orderUuid(uuid));
  } else {
    throw new Error("Invalid order query scope");
  }
  const jwt = createUpbitJwt(accessKey, secretKey, query);
  const upstream = await fetchImpl(url + "?" + query, {
    method: "GET",
    headers: {
      authorization: "Bearer " + jwt,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!upstream.ok) throw new Error("Upbit order request failed");
  const payload = await upstream.json();
  if (scope === "detail") return normalizeUpbitOrder(payload);
  if (!Array.isArray(payload)) throw new Error("Upbit orders response was not an array");
  return Object.freeze(payload.map(normalizeUpbitOrder));
}

function createRequestHandler({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  return async function handleRequest(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "nusa-upbit" });
      return;
    }

    if (url.pathname === ACCOUNT_SUMMARY_PATH || url.pathname === LEGACY_ACCOUNTS_PATH) {
      if (request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
        return;
      }

      let bridgeToken;
      try {
        bridgeToken = requiredEnv(env, "NUSA_API_TOKEN");
      } catch {
        sendJson(response, 503, { ok: false, error: "SERVICE_NOT_CONFIGURED" });
        return;
      }

      if (!safeTokenMatch(request.headers.authorization, bridgeToken)) {
        sendJson(response, 401, { ok: false, error: "UNAUTHORIZED" });
        return;
      }

      try {
        const summary = await loadUpbitAccountSummary({ env, fetchImpl, now: now() });
        sendJson(response, 200, summary);
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        console.error("upbit-readonly accounts request failed", { name });
        sendJson(response, 502, { ok: false, error: "UPSTREAM_FAILURE" });
      }
      return;
    }

    let orderScope = null;
    let orderUuidValue = null;
    if (url.pathname === ORDERS_OPEN_PATH) orderScope = "open";
    else if (url.pathname === ORDERS_HISTORY_PATH) orderScope = "history";
    else if (url.pathname.startsWith(ORDER_DETAIL_PREFIX)) {
      orderScope = "detail";
      orderUuidValue = url.pathname.slice(ORDER_DETAIL_PREFIX.length);
    }
    if (orderScope) {
      if (request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
        return;
      }
      let bridgeToken;
      try {
        bridgeToken = requiredEnv(env, "NUSA_API_TOKEN");
      } catch {
        sendJson(response, 503, { ok: false, error: "SERVICE_NOT_CONFIGURED" });
        return;
      }
      if (!safeTokenMatch(request.headers.authorization, bridgeToken)) {
        sendJson(response, 401, { ok: false, error: "UNAUTHORIZED" });
        return;
      }
      if (orderScope === "detail") {
        try {
          orderUuid(orderUuidValue);
        } catch {
          sendJson(response, 400, { ok: false, error: "INVALID_ORDER_UUID" });
          return;
        }
      }
      try {
        const orders = await loadUpbitOrders({ env, fetchImpl, scope: orderScope, uuid: orderUuidValue });
        sendJson(response, 200, orders);
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        console.error("upbit-readonly orders request failed", { name });
        sendJson(response, 502, { ok: false, error: "UPSTREAM_FAILURE" });
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "NOT_FOUND" });
  };
}

function startServer({ env = process.env, fetchImpl = globalThis.fetch, port = DEFAULT_PORT } = {}) {
  const configuredPort = env[PORT_ENV] === undefined ? port : Number(env[PORT_ENV]);
  if (!Number.isSafeInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65535) {
    throw new Error(`${PORT_ENV} must be an integer in [1024, 65535]`);
  }
  const server = http.createServer(createRequestHandler({ env, fetchImpl }));
  server.listen(configuredPort, LOOPBACK_HOST, () => {
    console.log(`nusa-upbit listening on ${LOOPBACK_HOST}:${configuredPort}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  LOOPBACK_HOST,
  DEFAULT_PORT,
  PORT_ENV,
  UPBIT_ACCOUNTS_URL,
  ACCOUNT_SUMMARY_PATH,
  LEGACY_ACCOUNTS_PATH,
  ORDERS_OPEN_URL,
  ORDERS_HISTORY_URL,
  ORDER_URL,
  ORDERS_OPEN_PATH,
  ORDERS_HISTORY_PATH,
  ORDER_DETAIL_PREFIX,
  createRequestHandler,
  createUpbitJwt,
  loadUpbitAccounts,
  loadUpbitAccountSummary,
  loadUpbitOrders,
  normalizeUpbitAccount,
  normalizeUpbitAccountSummary,
  normalizeUpbitOrder,
  safeTokenMatch,
  startServer,
};
