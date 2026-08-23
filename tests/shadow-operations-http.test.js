const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");

const fixtureCredential = "shadow-fixture-credential";
const principal = Object.freeze({ userId: "shadow-user", email: "shadow@nusa.local", scopes: Object.freeze(["dashboard:read"]) });
const verifier = { ownerPrincipal: principal, verify(value) { return value === fixtureCredential ? principal : undefined; } };
const snapshot = Object.freeze({ schemaVersion: 1, mode: "SHADOW", readOnly: true, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY", runtimeStatus: "RUNNING", generatedAt: 1000, sessionId: "shadow-session", symbol: "KRW-BTC", strategyId: "shadow-strategy", marketDataStatus: "CONNECTED", marketFreshness: "FRESH", marketConnection: null, admission: { duplicateCandleCount: 0, staleCandleCount: 0, outOfOrderCandleCount: 0, lastClosedCandleTime: null, closedCandleCount: 0 }, blockers: [], events: [], counters: { signalCount: 0, hypotheticalOrderCount: 0, hypotheticalFillCount: 0, actualBrokerCallCount: 0, actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0 } });

function request(port, method, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: route, headers: { ...headers, connection: "close" } }, (res) => { let body = ""; res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body })); });
    req.on("error", reject); req.end();
  });
}

test("Shadow operations is authenticated GET-only and preserves safety invariants", async () => {
  const handle = startCloudDashboardServer({ port: 41921, tokenVerifier: verifier, loadDashboard: () => { throw new Error("unused"); }, loadShadowOperations: () => snapshot });
  try {
    assert.equal((await request(handle.port, "GET", "/api/shadow-operations")).status, 401);
    const response = await request(handle.port, "GET", "/api/shadow-operations", { authorization: `Bearer ${fixtureCredential}` });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.mode, "SHADOW");
    assert.equal(body.readOnly, true);
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.aiAuthority, "ZERO_AUTHORITY");
    assert.equal((await request(handle.port, "POST", "/api/shadow-operations", { authorization: `Bearer ${fixtureCredential}` })).status, 405);
  } finally { await handle.stop(); }
});

test("Shadow operations fails closed when provider is absent", async () => {
  const handle = startCloudDashboardServer({ port: 41922, tokenVerifier: verifier, loadDashboard: () => { throw new Error("unused"); } });
  try { assert.equal((await request(handle.port, "GET", "/api/shadow-operations", { authorization: `Bearer ${fixtureCredential}` })).status, 503); }
  finally { await handle.stop(); }
});
