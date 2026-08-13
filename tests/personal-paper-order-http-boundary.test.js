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
const blocked = () => ({ schemaVersion: 1, status: "BLOCKED", reason: "TEST_BLOCK", liveAuthority: "NONE", productionMutationAllowed: false });
const parse = (response) => JSON.parse(response.body);

test("missing auth and dashboard-only scope never reach PAPER mutation callback", () => {
  let calls = 0;
  const deps = { tokenVerifier: verifier(["paper:trade"]), submitOrder: () => { calls += 1; return blocked(); } };
  assert.equal(handlePersonalPaperOrderHttp({ method: "POST", headers: { "idempotency-key": command().idempotencyKey } }, command(), deps).status, 401);
  assert.equal(calls, 0);
  const forbidden = handlePersonalPaperOrderHttp(request(), command(), { tokenVerifier: verifier(["dashboard:read"]), submitOrder: () => { calls += 1; return blocked(); } });
  assert.equal(forbidden.status, 403); assert.equal(calls, 0);
});

test("idempotency mismatch, LIVE authority, and malformed quantity fail before submit", () => {
  let calls = 0;
  const submitOrder = () => { calls += 1; return blocked(); };
  const mismatch = handlePersonalPaperOrderHttp({ method: "POST", headers: { authorization: "Bearer valid-token", "idempotency-key": "paper-http-other-0001" } }, command(), { tokenVerifier: verifier(["paper:trade"]), submitOrder });
  assert.equal(mismatch.status, 400); assert.equal(parse(mismatch).error, "IDEMPOTENCY_KEY_MISMATCH");
  for (const body of [command({ authority: "LIVE" }), command({ productionMutationAllowed: true }), command({ quantity: -1 })]) {
    assert.equal(handlePersonalPaperOrderHttp(request(), body, { tokenVerifier: verifier(["paper:trade"]), submitOrder }).status, 400);
  }
  assert.equal(calls, 0);
});

test("valid PAPER request binds callback result to exact command while preserving zero LIVE authority", () => {
  const submitted = command(); let calls = 0; let observed;
  const response = handlePersonalPaperOrderHttp(request(), submitted, {
    tokenVerifier: verifier(["paper:trade"]),
    submitOrder: (_principal, item) => { calls += 1; observed = item; return blocked(); }
  });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.deepEqual(observed, submitted);
  const payload = parse(response);
  assert.equal(payload.idempotencyKey, submitted.idempotencyKey);
  assert.equal(payload.market, submitted.market);
  assert.equal(payload.side, submitted.side);
  assert.equal(payload.liveAuthority, "NONE");
  assert.equal(payload.productionMutationAllowed, false);
});

test("persistence infrastructure failure maps to 503 and GET fails closed", () => {
  const unavailable = handlePersonalPaperOrderHttp(request(), command(), {
    tokenVerifier: verifier(["paper:trade"]),
    submitOrder: () => ({ schemaVersion: 1, status: "BLOCKED", reason: "paper account persistence failed", liveAuthority: "NONE", productionMutationAllowed: false })
  });
  assert.equal(unavailable.status, 503); assert.equal(parse(unavailable).error, "PAPER_ORDER_UNAVAILABLE");
  let calls = 0;
  const method = handlePersonalPaperOrderHttp({ method: "GET", headers: { authorization: "Bearer valid-token", "idempotency-key": command().idempotencyKey } }, command(), { tokenVerifier: verifier(["paper:trade"]), submitOrder: () => { calls += 1; return blocked(); } });
  assert.equal(method.status, 405); assert.equal(method.headers.allow, "POST"); assert.equal(calls, 0);
});
