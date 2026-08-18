const test = require("node:test");
const assert = require("node:assert/strict");
const { submitPersonalPaperOrder } = require("../dist/apps/mobile/src/personalPaperOrderClient.js");
const { clearConfiguredPaperEndpoint, markPaperConnectionVerified, setConfiguredPaperEndpoint } = require("../dist/apps/mobile/src/paperConnectionSession.js");

const command = () => ({ schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, idempotencyKey: "paper-client-00000001", market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001 });
const blocked = () => ({ schemaVersion: 1, status: "BLOCKED", idempotencyKey: "paper-client-00000001", market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001, reason: "TEST", liveAuthority: "NONE", productionMutationAllowed: false });
const SESSION_FIXTURE = "approved-access-fixture-00000001";
const credentialProvider = async () => SESSION_FIXTURE;

const clear = () => clearConfiguredPaperEndpoint();
test.beforeEach(clear); test.afterEach(clear);

test("endpoint identity change revokes verification before credential transport", async () => {
  setConfiguredPaperEndpoint("https://paper.example.test");
  markPaperConnectionVerified("https://paper.example.test");
  setConfiguredPaperEndpoint("https://other.example.test");
  let credentialCalls = 0;
  let requestCalls = 0;
  const result = await submitPersonalPaperOrder({
    baseUrl: "https://ignored.invalid",
    credentialProvider: async () => { credentialCalls += 1; return SESSION_FIXTURE; },
    request: async () => { requestCalls += 1; throw new Error("must not call"); }
  }, command());
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(credentialCalls, 0);
  assert.equal(requestCalls, 0);
});

test("order client sends no credential before Settings endpoint verification", async () => {
  setConfiguredPaperEndpoint("https://paper.example.test");
  let credentialCalls = 0;
  let requestCalls = 0;
  const result = await submitPersonalPaperOrder({
    baseUrl: "https://ignored.invalid",
    credentialProvider: async () => { credentialCalls += 1; return SESSION_FIXTURE; },
    request: async () => { requestCalls += 1; throw new Error("must not call"); }
  }, command());
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(credentialCalls, 0);
  assert.equal(requestCalls, 0);
});

test("order client refuses insecure remote HTTP before credential transport", async () => {
  setConfiguredPaperEndpoint("http://192.168.1.5:41731");
  markPaperConnectionVerified("http://192.168.1.5:41731");
  let credentialCalls = 0;
  let requestCalls = 0;
  const result = await submitPersonalPaperOrder({
    baseUrl: "https://ignored.invalid",
    credentialProvider: async () => { credentialCalls += 1; return SESSION_FIXTURE; },
    request: async () => { requestCalls += 1; throw new Error("must not call"); }
  }, command());
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(credentialCalls, 0);
  assert.equal(requestCalls, 0);
  assert.match(result.reason, /insecure remote HTTP/i);
});

test("verified endpoint is authoritative and redirects are rejected", async () => {
  setConfiguredPaperEndpoint("https://paper.example.test");
  markPaperConnectionVerified("https://paper.example.test");
  let observed = "";
  const result = await submitPersonalPaperOrder({
    baseUrl: "https://attacker.invalid",
    credentialProvider,
    request: async (url) => {
      observed = String(url);
      return { ok: true, status: 200, redirected: false, url: "https://paper.example.test/api/paper-orders", json: async () => blocked() };
    }
  }, command());
  assert.equal(result.status, "READY");
  assert.equal(observed, "https://paper.example.test/api/paper-orders");

  const redirected = await submitPersonalPaperOrder({
    baseUrl: "https://ignored.invalid",
    credentialProvider,
    request: async () => ({ ok: true, status: 200, redirected: true, url: "https://other.example.test/api/paper-orders", json: async () => blocked() })
  }, command());
  assert.equal(redirected.status, "UNAVAILABLE");
  assert.match(redirected.reason, /redirect/i);
});
