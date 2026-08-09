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
  const session = new InMemoryDashboardCredentialSession();
  session.connect(TOKEN);
  markPaperConnectionVerified(VERIFIED);
  return session;
}

function cleanup(session) {
  session?.clear();
  clearConfiguredPaperEndpoint();
}

test("normal PAPER read rejects a caller/env URL that differs from verified Settings endpoint before credential access", async () => {
  const session = setupVerifiedSession();
  let credentialReads = 0;
  let requests = 0;
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ATTACKER,
      credentialProvider: async () => { credentialReads += 1; return session.credentialProvider(); },
      request: async () => { requests += 1; throw new Error("must not call"); }
    });

    assert.equal(result.status, "NOT_CONFIGURED");
    assert.equal(credentialReads, 0);
    assert.equal(requests, 0);
    assert.match(result.reason, /does not match the configured connection/i);
  } finally {
    cleanup(session);
  }
});

test("normal PAPER order rejects a caller/env URL that differs from verified Settings endpoint before credential access", async () => {
  const session = setupVerifiedSession();
  let credentialReads = 0;
  let requests = 0;
  try {
    const result = await submitPersonalPaperOrder({
      baseUrl: ATTACKER,
      credentialProvider: async () => { credentialReads += 1; return session.credentialProvider(); },
      request: async () => { requests += 1; throw new Error("must not call"); }
    }, order);

    assert.equal(result.status, "NOT_CONFIGURED");
    assert.equal(credentialReads, 0);
    assert.equal(requests, 0);
    assert.match(result.reason, /does not match the configured connection/i);
  } finally {
    cleanup(session);
  }
});

test("verified Settings endpoint is the only permitted credential-bearing PAPER target", async () => {
  const session = setupVerifiedSession();
  let observedReadUrl = null;
  let observedOrderUrl = null;
  try {
    const readResult = await loadPersonalPaperOperations({
      baseUrl: VERIFIED,
      credentialProvider: session.credentialProvider,
      request: async (url) => {
        observedReadUrl = String(url);
        return { ok: false, status: 503 };
      }
    });
    assert.equal(readResult.status, "UNAVAILABLE");
    assert.equal(observedReadUrl, `${VERIFIED}/api/paper-operations`);

    const orderResult = await submitPersonalPaperOrder({
      baseUrl: VERIFIED,
      credentialProvider: session.credentialProvider,
      request: async (url) => {
        observedOrderUrl = String(url);
        return { ok: false, status: 503, redirected: false, url: `${VERIFIED}/api/paper-orders`, json: async () => ({ error: "TEST_UNAVAILABLE" }) };
      }
    }, order);
    assert.equal(orderResult.status, "UNAVAILABLE");
    assert.equal(observedOrderUrl, `${VERIFIED}/api/paper-orders`);
  } finally {
    cleanup(session);
  }
});
