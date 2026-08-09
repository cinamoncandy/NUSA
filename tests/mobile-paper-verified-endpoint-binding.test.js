const test = require("node:test");
const assert = require("node:assert/strict");

const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { submitPersonalPaperOrder } = require("../dist/apps/mobile/src/personalPaperOrderClient.js");
const {
  clearConfiguredPaperEndpoint,
  markPaperConnectionVerified,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

const VERIFIED = "https://paper-verified.example.test";
const ATTACKER = "https://caller-env-attacker.example.test";
const TOKEN = "verified-endpoint-bound-dashboard-token-123456";

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

function setupVerifiedSession() {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(VERIFIED);
  markPaperConnectionVerified(VERIFIED);
  const session = new InMemoryDashboardCredentialSession();
  session.connect(TOKEN);
  return session;
}

function cleanup(session) {
  session?.clear();
  clearConfiguredPaperEndpoint();
}

test("normal PAPER read ignores caller/env URL and sends credential only to verified Settings endpoint", async () => {
  const session = setupVerifiedSession();
  let observedUrl = null;
  let observedAuthorization = null;
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ATTACKER,
      credentialProvider: session.credentialProvider,
      request: async (url, init) => {
        observedUrl = String(url);
        observedAuthorization = init?.headers?.authorization ?? null;
        return { ok: false, status: 503 };
      }
    });

    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(observedUrl, `${VERIFIED}/api/paper-operations`);
    assert.equal(observedAuthorization, `Bearer ${TOKEN}`);
    assert.equal(String(observedUrl).startsWith(ATTACKER), false, "caller/env URL must never receive credential transport");
  } finally {
    cleanup(session);
  }
});

test("normal PAPER order ignores caller/env URL and sends credential only to verified Settings endpoint", async () => {
  const session = setupVerifiedSession();
  let observedUrl = null;
  let observedAuthorization = null;
  try {
    const result = await submitPersonalPaperOrder({
      baseUrl: ATTACKER,
      credentialProvider: session.credentialProvider,
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
    assert.equal(observedAuthorization, `Bearer ${TOKEN}`);
    assert.equal(String(observedUrl).startsWith(ATTACKER), false, "caller/env URL must never receive order credential transport");
  } finally {
    cleanup(session);
  }
});
