const test = require("node:test");
const assert = require("node:assert/strict");

const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const {
  clearConfiguredPaperEndpoint,
  markPaperConnectionVerified,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

const ENDPOINT = "https://paper-read-guard.example.test";
const TOKEN = "paper-read-guard-dashboard-token-123456";

function setup() {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  const session = new InMemoryDashboardCredentialSession();
  session.connect(TOKEN);
  markPaperConnectionVerified(ENDPOINT);
  return session;
}

function cleanup(session) {
  session?.clear();
  clearConfiguredPaperEndpoint();
}

test("credential-bearing PAPER read forbids redirects at fetch boundary", async () => {
  const session = setup();
  let requestCount = 0;
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ENDPOINT,
      credentialProvider: session.credentialProvider,
      request: async (url, init) => {
        requestCount += 1;
        assert.equal(String(url), `${ENDPOINT}/api/paper-operations`);
        assert.equal(init?.redirect, "error");
        assert.equal(init?.headers?.authorization, `Bearer ${TOKEN}`);
        return {
          ok: true,
          status: 200,
          redirected: true,
          url: "https://redirect-target.example.test/api/paper-operations",
          json: async () => ({})
        };
      }
    });
    assert.equal(requestCount, 1);
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.reason, /redirect is prohibited/i);
  } finally { cleanup(session); }
});

test("credential-bearing PAPER read rejects a changed final endpoint", async () => {
  const session = setup();
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ENDPOINT,
      credentialProvider: session.credentialProvider,
      request: async () => ({
        ok: true,
        status: 200,
        redirected: false,
        url: "https://different-final.example.test/api/paper-operations",
        json: async () => ({})
      })
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.reason, /final endpoint changed/i);
  } finally { cleanup(session); }
});

test("PAPER read timeout is bounded before credential-bearing transport", async () => {
  const session = setup();
  let credentialReads = 0;
  let requests = 0;
  try {
    const invalid = await loadPersonalPaperOperations({
      baseUrl: ENDPOINT,
      credentialProvider: async () => { credentialReads += 1; return session.credentialProvider(); },
      request: async () => { requests += 1; return { ok: false, status: 503 }; },
      timeoutMs: 0
    });
    assert.equal(invalid.status, "UNAVAILABLE");
    assert.match(invalid.reason, /timeout must be an integer/i);
    assert.equal(credentialReads, 0);
    assert.equal(requests, 0);
  } finally { cleanup(session); }
});