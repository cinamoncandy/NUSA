"use strict";

const crypto = require("node:crypto");
const http = require("node:http");

const DEFAULT_PORT = 3000;
const LOOPBACK_HOST = "127.0.0.1";
const UPBIT_ACCOUNTS_URL = "https://api.upbit.com/v1/accounts";
const UPSTREAM_TIMEOUT_MS = 10_000;

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createUpbitJwt(accessKey, secretKey) {
  const header = encodeJson({ alg: "HS512", typ: "JWT" });
  const payload = encodeJson({ access_key: accessKey, nonce: crypto.randomUUID() });
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

function createRequestHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  return async function handleRequest(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "nusa-upbit" });
      return;
    }

    if (url.pathname === "/api/upbit/accounts") {
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
        const accounts = await loadUpbitAccounts({ env, fetchImpl });
        sendJson(response, 200, accounts);
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        console.error("upbit-readonly accounts request failed", { name });
        sendJson(response, 502, { ok: false, error: "UPSTREAM_FAILURE" });
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "NOT_FOUND" });
  };
}

function startServer({ env = process.env, fetchImpl = globalThis.fetch, port = DEFAULT_PORT } = {}) {
  const server = http.createServer(createRequestHandler({ env, fetchImpl }));
  server.listen(port, LOOPBACK_HOST, () => {
    console.log(`nusa-upbit listening on ${LOOPBACK_HOST}:${port}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  LOOPBACK_HOST,
  UPBIT_ACCOUNTS_URL,
  createRequestHandler,
  createUpbitJwt,
  loadUpbitAccounts,
  safeTokenMatch,
  startServer,
};
