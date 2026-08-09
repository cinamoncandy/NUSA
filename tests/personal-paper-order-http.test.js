const test = require("node:test");
const assert = require("node:assert/strict");
const { handlePersonalPaperOrderHttp } = require("../dist/apps/cloud/src/personalPaperOrderHttp.js");

const command = (overrides = {}) => ({
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey: "paper-http-000000001",
  market: "KRW-BTC",
  side: "BUY",
  orderType: "MARKET",
  quantity: 0.001,
  ...overrides
});
const request = (overrides = {}) => ({
  method: "POST",
  headers: { authorization: "Bearer valid-token", "idempotency-key": command().idempotencyKey },
  ...overrides
});
const verifier = (scopes) => ({ verify: (token) => token === "valid-token" ? { userId: "operator", scopes } : undefined });
const blockedResult = () => ({ schemaVersion: 1, status: "BLOCKED", reason: "TEST_BLOCK", liveAuthority: "NONE", productionMutationAllowed: false });

function parse(response) { return JSON.parse(response.body); }

test("PAPER order HTTP rejects missing auth before submit", () => {
  let calls = 0;
  const response = handlePersonalPaperOrderHttp({ method: "POST", headers: { "idempotency-key": command().idempotencyKey } }, command(), { tokenVerifier: verifier(["paper:trade"]), submitOrder: () => { calls += 1; return blockedResult(); } });
  assert.equal(response.status, 401); assert.equal(calls, 0);
});

test("dashboard read scope alone cannot mutate PAPER", () => {
  let calls = 0;
  const response = handlePersonalPaperOrderHttp(request(), command(), { tokenVerifier: verifier(["dashboard:read"]), submitOrder: () => { calls += 1; return blockedResult(); } });
  assert.equal(response.status, 403); assert.equal(calls, 0);
});

test("PAPER order HTTP rejects idempotency header mismatch before submit", () => {
  let calls = 0;
  const response = handlePersonalPaperOrderHttp({ method: "POST", headers: { authorization: "Bearer valid-token", "idempotency-key": "paper-http-other-0001" } }, command(), { tokenVerifier: verifier(["paper:trade"]), submitOrder: () => { calls += 1; return blockedResult(); } });
  assert.equal(response.status, 400); assert.equal(parse(response).error, "IDEMPOTENCY_KEY_MISMATCH"); assert.equal(calls, 0);
});

test("PAPER order HTTP rejects LIVE or malformed body before submit", () => {
  for (const body of [command({ authority: "LIVE" }), command({ productionMutationAllowed: true }), command({ quantity: -1 })]) {
    let calls = 0;
    const response = handlePersonalPaperOrderHttp(request(), body, { tokenVerifier: verifier(["paper:trade"]), submitOrder: () => { calls += 1; return blockedResult(); } });
    assert.equal(response.status, 400); assert.equal(calls, 0);
  }
});

test("valid PAPER request reaches callback once and wire result is bound to exact command", () => {
  const submitted = command(); let calls = 0; let observed;
  const response = handlePersonalPaperOrderHttp(request(), submitted, {
    tokenVerifier: verifier(["dashboard:read", "paper:trade"]),
    submitOrder: (_principal, item) => { calls += 1; observed = item; return blockedResult(); }
  });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.deepEqual(observed, submitted);
  const payload = parse(response);
  assert.equal(payload.idempotencyKey, submitted.idempotencyKey);
  assert.equal(payload.market, submitted.market);
  assert.equal(payload.side, submitted.side);
  assert.equal(payload.authority, undefined);
  assert.equal(payload.liveAuthority, "NONE");
  assert.equal(payload.productionMutationAllowed, false);
});

test("PAPER persistence infrastructure failure is HTTP unavailable, not a business rejection", () => {
  const response = handlePersonalPaperOrderHttp(request(), command(), {
    tokenVerifier: verifier(["paper:trade"]),
    submitOrder: () => ({ schemaVersion: 1, status: "BLOCKED", reason: "paper account persistence failed", liveAuthority: "NONE", productionMutationAllowed: false })
  });
  assert.equal(response.status, 503);
  assert.equal(parse(response).error, "PAPER_ORDER_UNAVAILABLE");
});

test("non-POST PAPER order route fails closed", () => {
  let calls = 0;
  const response = handlePersonalPaperOrderHttp({ method: "GET", headers: { authorization: "Bearer valid-token", "idempotency-key": command().idempotencyKey } }, command(), { tokenVerifier: verifier(["paper:trade"]), submitOrder: () => { calls += 1; return blockedResult(); } });
  assert.equal(response.status, 405); assert.equal(calls, 0); assert.equal(response.headers.allow, "POST");
});