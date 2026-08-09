const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PersonalPaperOrderRetryIdentity,
  submitPersonalPaperOrderWithRetryIdentity
} = require("../dist/apps/mobile/src/personalPaperOrderClient.js");
const { clearConfiguredPaperEndpoint, markPaperConnectionVerified, setConfiguredPaperEndpoint } = require("../dist/apps/mobile/src/paperConnectionSession.js");

const ENDPOINT = "https://paper.example.test";
const draft = Object.freeze({ schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001 });
const definitiveBlocked = (submitted) => Object.freeze({ schemaVersion: 1, status: "BLOCKED", idempotencyKey: submitted.idempotencyKey, market: submitted.market, side: submitted.side, orderType: submitted.orderType, quantity: submitted.quantity, reason: "TEST_BLOCK", liveAuthority: "NONE", productionMutationAllowed: false });
const responseFor = (submitted) => ({ ok: true, status: 200, redirected: false, url: `${ENDPOINT}/api/paper-orders`, json: async () => definitiveBlocked(submitted) });
const keyFactory = () => { let sequence = 0; return () => `paper-mobile-retry-${String(++sequence).padStart(8, "0")}`; };

test.beforeEach(() => { clearConfiguredPaperEndpoint(); setConfiguredPaperEndpoint(ENDPOINT); markPaperConnectionVerified(ENDPOINT); });
test.afterEach(() => clearConfiguredPaperEndpoint());

test("retry identity preserves unresolved keys across draft switching and rotates only the settled draft", () => {
  const identity = new PersonalPaperOrderRetryIdentity();
  const createKey = keyFactory();
  const buyFingerprint = "KRW-BTC|BUY|MARKET|0.001";
  const sellFingerprint = "KRW-BTC|SELL|MARKET|0.001";
  const buy = identity.acquire(buyFingerprint, createKey);
  const sell = identity.acquire(sellFingerprint, createKey);
  assert.notEqual(sell, buy);
  assert.equal(identity.acquire(buyFingerprint, createKey), buy, "returning to an unresolved draft must reuse its original key");
  assert.equal(identity.acquire(sellFingerprint, createKey), sell, "each unresolved semantic draft keeps its own key");
  identity.settle(buy);
  const nextBuy = identity.acquire(buyFingerprint, createKey);
  assert.notEqual(nextBuy, buy, "definitive result must consume only that draft's prior submission identity");
  assert.equal(identity.acquire(sellFingerprint, createKey), sell, "settling one draft must not discard another unresolved key");
});

test("retry identity bounds unresolved draft accumulation", () => {
  const identity = new PersonalPaperOrderRetryIdentity();
  const createKey = keyFactory();
  for (let index = 0; index < 16; index += 1) identity.acquire(`draft-${index}`, createKey);
  assert.throws(() => identity.acquire("draft-overflow", createKey), /Too many unresolved/);
});

test("ambiguous network retry sends the same idempotency key until a definitive PAPER result arrives", async () => {
  const identity = new PersonalPaperOrderRetryIdentity();
  const createKey = keyFactory();
  const fingerprint = JSON.stringify([draft.market, draft.side, draft.orderType, draft.quantity, null]);
  const observedKeys = [];
  const first = await submitPersonalPaperOrderWithRetryIdentity({ baseUrl: ENDPOINT, credentialProvider: async () => "1234567890123456", request: async (_url, init) => { observedKeys.push(init.headers["idempotency-key"]); throw new Error("connection reset after request write"); } }, identity, fingerprint, createKey, draft);
  assert.equal(first.status, "UNAVAILABLE");
  const second = await submitPersonalPaperOrderWithRetryIdentity({ baseUrl: ENDPOINT, credentialProvider: async () => "1234567890123456", request: async (_url, init) => { observedKeys.push(init.headers["idempotency-key"]); const submitted = JSON.parse(init.body); return responseFor(submitted); } }, identity, fingerprint, createKey, draft);
  assert.equal(second.status, "READY"); assert.equal(second.result.status, "BLOCKED"); assert.equal(observedKeys[1], observedKeys[0], "ambiguous retry must hit the server with the original idempotency key");
  const third = await submitPersonalPaperOrderWithRetryIdentity({ baseUrl: ENDPOINT, credentialProvider: async () => "1234567890123456", request: async (_url, init) => { observedKeys.push(init.headers["idempotency-key"]); throw new Error("stop after observing new submission identity"); } }, identity, fingerprint, createKey, draft);
  assert.equal(third.status, "UNAVAILABLE"); assert.notEqual(observedKeys[2], observedKeys[1], "a new user submission after a definitive result must get a fresh key");
});
