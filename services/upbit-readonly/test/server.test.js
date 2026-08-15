"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LOOPBACK_HOST,
  UPBIT_ACCOUNTS_URL,
  createUpbitJwt,
  loadUpbitAccounts,
  safeTokenMatch,
} = require("../server");

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
  assert.ok(payload.nonce.length > 0);
  assert.ok(signaturePart.length > 0);
});

test("accounts loader performs GET against the read-only Upbit endpoint", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => [{ currency: "KRW", balance: "1000", locked: "0" }],
    };
  };

  const accounts = await loadUpbitAccounts({
    env: { UPBIT_ACCESS_KEY: "access-key", UPBIT_SECRET_KEY: "secret-key" },
    fetchImpl,
  });

  assert.equal(captured.url, UPBIT_ACCOUNTS_URL);
  assert.equal(captured.options.method, "GET");
  assert.match(captured.options.headers.authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.equal(accounts[0].currency, "KRW");
});

test("accounts loader rejects malformed provider payloads", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ currency: "KRW" }) });
  await assert.rejects(
    loadUpbitAccounts({
      env: { UPBIT_ACCESS_KEY: "access-key", UPBIT_SECRET_KEY: "secret-key" },
      fetchImpl,
    }),
    /not an array/,
  );
});
