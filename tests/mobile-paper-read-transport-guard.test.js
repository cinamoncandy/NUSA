const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const {
  clearConfiguredPaperEndpoint,
  markPaperConnectionVerified,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

const ENDPOINT = "https://paper-read-guard.example.test";
const SESSION_FIXTURE = ["paper", "read", "guard", "approved", "session", "123456"].join("-");
const ROTATED_SESSION_FIXTURE = ["paper", "read", "guard", "rotated", "session", "654321"].join("-");

function setupCredential() {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  markPaperConnectionVerified(ENDPOINT);
  let token = SESSION_FIXTURE;
  return {
    credentialProvider: async () => token,
    rotate: () => { token = ROTATED_SESSION_FIXTURE; },
    cleanup: () => clearConfiguredPaperEndpoint()
  };
}

test("credential-bearing PAPER read forbids redirects at fetch boundary", async () => {
  const session = setupCredential();
  let requestCount = 0;
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ENDPOINT,
      credentialProvider: session.credentialProvider,
      request: async (url, init) => {
        requestCount += 1;
        assert.equal(String(url), `${ENDPOINT}/api/paper-operations`);
        assert.equal(init?.redirect, "error");
        assert.equal(init?.headers?.authorization, `Bearer ${SESSION_FIXTURE}`);
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
  } finally { session.cleanup(); }
});

test("credential-bearing PAPER read rejects a changed final endpoint", async () => {
  const session = setupCredential();
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
  } finally { session.cleanup(); }
});

test("PAPER read discards a response if the credential rotates while the request is in flight", async () => {
  const session = setupCredential();
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ENDPOINT,
      credentialProvider: session.credentialProvider,
      request: async (_url, init) => {
        assert.equal(init?.headers?.authorization, `Bearer ${SESSION_FIXTURE}`);
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: `${ENDPOINT}/api/paper-operations`,
          json: async () => {
            session.rotate();
            return {};
          }
        };
      }
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.reason, /connection changed while the request was in flight/i);
  } finally { session.cleanup(); }
});

test("PAPER read timeout is bounded before credential-bearing transport", async () => {
  const session = setupCredential();
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
  } finally { session.cleanup(); }
});
