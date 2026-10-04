const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const { clearConfiguredPaperEndpoint, setConfiguredPaperEndpoint } = require("../dist/apps/mobile/src/paperConnectionSession.js");

const ENDPOINT = "https://paper-failure-evidence.example.test";
const TOKEN = ["paper", "failure", "evidence", "fixture", "123456"].join("-");

function provider() { return Object.assign(async () => TOKEN, { noteProjectionResult() {} }); }

async function load(request, extra = {}) {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  try {
    return await loadPersonalPaperOperations({
      baseUrl: ENDPOINT, credentialProvider: provider(), allowUnverifiedEndpoint: true, request, ...extra
    });
  } finally { clearConfiguredPaperEndpoint(); }
}

for (const [status, category] of [[401,"AUTH_REJECTED"],[403,"AUTH_REJECTED"],[404,"ROUTE_MISSING"],[429,"RATE_LIMITED"],[500,"BACKEND_FAILURE"],[503,"BACKEND_FAILURE"]]) {
  test(`HTTP ${status} preserves structured non-secret PAPER failure evidence`, async () => {
    const result = await load(async () => new Response("ignored", { status }));
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.failure.category, category);
    assert.equal(result.failure.route, "/api/paper-operations");
    assert.equal(result.failure.httpStatus, status);
    assert.equal(Number.isFinite(result.failure.observedAt), true);
    assert.equal(JSON.stringify(result.failure).includes(TOKEN), false);
  });
}

test("transport failure is distinct and does not expose credential material", async () => {
  const result = await load(async () => { throw new TypeError("network unavailable"); });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.failure.category, "TRANSPORT_FAILURE");
  assert.equal(JSON.stringify(result.failure).includes(TOKEN), false);
});

test("timeout is classified separately from transport failure", async () => {
  const result = await load(() => new Promise(() => {}), { timeoutMs: 5 });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.failure.category, "TIMEOUT");
});

test("schema mismatch is fail-closed and classified", async () => {
  const result = await load(async () => new Response(JSON.stringify({ invalid: true }), {
    status: 200, headers: { "content-type": "application/json" }
  }));
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.failure.category, "SCHEMA_MISMATCH");
});

test("malformed JSON is schema mismatch, not transport failure", async () => {
  const result = await load(async () => new Response("{", {
    status: 200, headers: { "content-type": "application/json" }
  }));
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.failure.category, "SCHEMA_MISMATCH");
});

test("connection replacement wins over a stale HTTP error response", async () => {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  let calls = 0;
  const rotatingProvider = Object.assign(async () => (++calls === 1 ? TOKEN : `${TOKEN}-rotated`), { noteProjectionResult() {} });
  try {
    const result = await loadPersonalPaperOperations({
      baseUrl: ENDPOINT,
      credentialProvider: rotatingProvider,
      allowUnverifiedEndpoint: true,
      request: async () => new Response("rejected", { status: 401 })
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.failure.category, "CONNECTION_REPLACED");
  } finally { clearConfiguredPaperEndpoint(); }
});
