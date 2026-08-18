const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { submitPersonalPaperOrder } = require("../dist/apps/mobile/src/personalPaperOrderClient.js");
const {
  clearConfiguredPaperEndpoint,
  markPaperConnectionVerified,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

const VERIFIED = "https://paper-verified.example.test";
const ATTACKER = "https://caller-env-attacker.example.test";
const SESSION_FIXTURE = ["verified", "endpoint", "bound", "dashboard", "fixture", "123456"].join("-");
const credentialProvider = async () => SESSION_FIXTURE;

const order = Object.freeze({
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey: "paper-binding-test-00000001",
  market: "KRW-BTC",
  side: "BUY",
  orderType: "MARKET",
  quantity: 0.001
});

function setupVerifiedEndpoint() {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(VERIFIED);
  markPaperConnectionVerified(VERIFIED);
}

function cleanup() {
  clearConfiguredPaperEndpoint();
}

test("normal PAPER read ignores caller/env URL and sends credential only to verified Settings endpoint", async () => {
  setupVerifiedEndpoint();
  let observedUrl = null;
  let observedAuthorization = null;
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ATTACKER,
      credentialProvider,
      request: async (url, init) => {
        observedUrl = String(url);
        observedAuthorization = init?.headers?.authorization ?? null;
        return { ok: false, status: 503 };
      }
    });

    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(observedUrl, `${VERIFIED}/api/paper-operations`);
    assert.equal(observedAuthorization, `Bearer ${SESSION_FIXTURE}`);
    assert.equal(String(observedUrl).startsWith(ATTACKER), false, "caller/env URL must never receive credential transport");
  } finally {
    cleanup();
  }
});

test("normal PAPER order ignores caller/env URL and sends credential only to verified Settings endpoint", async () => {
  setupVerifiedEndpoint();
  let observedUrl = null;
  let observedAuthorization = null;
  try {
    const result = await submitPersonalPaperOrder({
      baseUrl: ATTACKER,
      credentialProvider,
      request: async (url, init) => {
        observedUrl = String(url);
        observedAuthorization = init?.headers?.authorization ?? null;
        return {
          ok: false,
          status: 503,
          redirected: false,
          url: `${VERIFIED}/api/paper-orders`,
          json: async () => ({ error: "TEST_UNAVAILABLE" })
        };
      }
    }, order);

    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(observedUrl, `${VERIFIED}/api/paper-orders`);
    assert.equal(observedAuthorization, `Bearer ${SESSION_FIXTURE}`);
    assert.equal(String(observedUrl).startsWith(ATTACKER), false, "caller/env URL must never receive order credential transport");
  } finally {
    cleanup();
  }
});
