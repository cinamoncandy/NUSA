const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { test } = require("node:test");

const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { createLiveReadinessSourceProvider } = require("../dist/apps/cloud/src/liveReadinessSourceProvider.js");
const { handleLiveReadinessHttp } = require("../dist/apps/cloud/src/liveReadinessHttp.js");
const { projectLiveReadinessObservabilitySnapshot } = require("../dist/apps/cloud/src/liveReadinessProjection.js");
const { validateLiveReadinessObservabilitySnapshot } = require("../dist/packages/contracts/src/liveReadinessObservability.js");
const { loadLiveReadinessOperations } = require("../dist/apps/mobile/src/liveReadinessOperationsClient.js");
const { setConfiguredPaperEndpoint, markPaperConnectionVerified } = require("../dist/apps/mobile/src/paperConnectionSession.js");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const NOW = "2026-08-24T12:00:00.000Z";
const HEAD = "a".repeat(40);
const principal = Object.freeze({ userId: "live-ready-user", email: "live-ready@nusa.local", scopes: Object.freeze(["dashboard:read"]) });
const verifier = { ownerPrincipal: principal, verify: (token) => token === "dashboard-token" ? principal : undefined };
const observation = (value, fingerprint) => Object.freeze({ value, freshness: "FRESH", observedAt: NOW, ...(fingerprint ? { fingerprint } : {}) });

function source() {
  const green = { maxNotionalPerOrder: 1000, maxDailyLoss: 100, maxOpenExposure: 5000, maxConcurrentPositions: 2, maxSlippageBps: 20, maxOrdersPerMinute: 10, marketAllowlist: ["KRW-BTC"] };
  const safeRuntime = { killSwitchActive: false, staleMarketData: false, reconciliationMismatch: false, exchangeError: false, abnormalBalanceDrift: false, riskBudgetBreached: false, strategyInvalidated: false, latencyOrSlippageBreached: false };
  return createLiveReadinessSourceProvider({
    now: () => NOW,
    sourceVersion: "live-ready-test-v1",
    readers: {
      currentHeadSha: () => HEAD,
      paperAutoLearning: () => observation("STABLE"),
      shadowReplay: () => observation("VALID"),
      realAccountMonitor: () => observation("CONNECTED"),
      governance: () => observation("APPROVED"),
      tradePermission: () => observation("PERMIT"),
      riskAuthority: () => observation("HEALTHY"),
      reconciliationTests: () => observation("PASS"),
      killSwitchTests: () => observation("PASS"),
      idempotencyTests: () => observation("PASS"),
      exchangeFaultTests: () => observation("PASS"),
      workflows: () => observation({ headSha: HEAD, ci: "PASS", mobileNative: "PASS", restrictedLiveSafety: "PASS", readOnlyBroker: "PASS", aiZeroAuthority: "PASS" }),
      prohibitedFinancialMutationScan: () => observation("ABSENT"),
      environmentFingerprint: () => observation("env-ref"),
      accountFingerprint: () => observation("acct-ref"),
      riskLimits: () => observation(green),
      runtimeSafety: () => observation(safeRuntime),
      authority: () => observation({ liveAuthority: "NONE", productionMutationAllowed: false }),
      activationState: () => observation("READY_FOR_MANUAL_ENABLE"),
      activationLeaseState: () => observation("ABSENT"),
    }
  });
}

function request(port, method, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: route, headers: { ...headers, connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("#661 LIVE_READY projection reuses the canonical provider and existing gate", () => {
  const projected = projectLiveReadinessObservabilitySnapshot(source().getSnapshot());
  assert.equal(projected.mode, "LIVE_READY");
  assert.equal(projected.status, "READY_FOR_MANUAL_ENABLE");
  assert.deepEqual(projected.blockers, []);
  assert.equal(projected.liveAuthority, "NONE");
  assert.equal(projected.productionMutationAllowed, false);
  assert.equal(projected.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(projected.provenance.sourceFingerprint.length, 64);
  assert.equal(projected.provenance.inputs.length, 20);
  assert.equal(projected.timeline.length, 0);
  assert.equal(Object.isFrozen(projected), true);
});

test("#661 LIVE_READY source is deterministic and missing evidence fails closed", () => {
  const first = projectLiveReadinessObservabilitySnapshot(source().getSnapshot());
  const second = projectLiveReadinessObservabilitySnapshot(source().getSnapshot());
  assert.deepEqual(first, second);
  const missing = createLiveReadinessSourceProvider({ now: () => NOW, sourceVersion: "missing" }).getSnapshot();
  const blocked = projectLiveReadinessObservabilitySnapshot(missing);
  assert.equal(blocked.status, "NOT_READY");
  assert.ok(blocked.blockers.includes("SOURCE_EVIDENCE_INCOMPLETE"));
  assert.equal(blocked.credentialReadiness, "UNKNOWN");
});

test("#661 LIVE_READY projection maps freshness, governance, risk, reconciliation and activation state", () => {
  const snapshot = source().getSnapshot();
  const projected = projectLiveReadinessObservabilitySnapshot(snapshot);
  assert.equal(projected.governance, "APPROVED");
  assert.equal(projected.tradePermission, "PERMIT");
  assert.equal(projected.riskAuthority, "HEALTHY");
  assert.equal(projected.reconciliationTests, "PASS");
  assert.equal(projected.credentialReadiness, "READY");
  assert.equal(projected.activationState, "READY_FOR_MANUAL_ENABLE");
  assert.equal(projected.activationLeaseState, "ABSENT");
  assert.equal(projected.freshness.workflows, "FRESH");
});

test("#661 LIVE_READY HTTP transport is authenticated, GET-only, redacted and idempotent", () => {
  let calls = 0;
  const dependencies = { tokenVerifier: verifier, loadSnapshot: () => { calls += 1; return source().getSnapshot(); } };
  const requestFor = (method = "GET", headers = { authorization: "Bearer dashboard-token" }) => ({ method, headers });
  const first = handleLiveReadinessHttp(requestFor(), dependencies);
  const second = handleLiveReadinessHttp(requestFor(), dependencies);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body), JSON.parse(second.body));
  assert.equal(calls, 2);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(handleLiveReadinessHttp(requestFor(method), dependencies).status, 405);
  assert.equal(handleLiveReadinessHttp(requestFor("GET", {}), dependencies).status, 401);
  assert.equal(first.body.includes("dashboard-token"), false);
  assert.equal(first.body.includes("account-id"), false);
});

test("#661 LIVE_READY route is wired to the production server and has no mutation sibling", async () => {
  const handle = startCloudDashboardServer({ port: 41931, tokenVerifier: verifier, loadDashboard: () => { throw new Error("unused"); }, loadLiveReadiness: () => source().getSnapshot() });
  try {
    assert.equal((await request(handle.port, "GET", "/api/live-readiness")).status, 401);
    const response = await request(handle.port, "GET", "/api/live-readiness", { authorization: "Bearer dashboard-token" });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).mode, "LIVE_READY");
    assert.equal((await request(handle.port, "POST", "/api/live-readiness", { authorization: "Bearer dashboard-token" })).status, 405);
  } finally { await handle.stop(); }
  const serverSource = read("apps/cloud/src/server.ts");
  assert.match(serverSource, /\/api\/live-readiness/);
  assert.equal(/live-readiness.*(activate|order|cancel|withdraw|transfer)/i.test(serverSource), false);
  const runtimeSource = read("apps/cloud/src/runtime.ts");
  assert.match(runtimeSource, /createLiveReadinessSourceProvider/);
  assert.match(runtimeSource, /loadLiveReadiness:\s*\(\)\s*=>\s*liveReadinessSourceProvider\.getSnapshot/);
  assert.match(runtimeSource, /getLiveReadinessSourceSnapshot/);
});

test("#661 mobile LIVE_READY client uses the verified PAPER session and GET only", async () => {
  setConfiguredPaperEndpoint("https://cloud.example");
  markPaperConnectionVerified("https://cloud.example");
  const payload = projectLiveReadinessObservabilitySnapshot(source().getSnapshot());
  const ready = await loadLiveReadinessOperations({ baseUrl: "https://cloud.example", credentialProvider: async () => "dashboard-token", request: async (url, init) => { assert.equal(url, "https://cloud.example/api/live-readiness"); assert.equal(init.method, "GET"); return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); } });
  assert.equal(ready.status, "READY");
  assert.equal(ready.snapshot.mode, "LIVE_READY");
  const failed = await loadLiveReadinessOperations({ baseUrl: "https://cloud.example", credentialProvider: async () => "dashboard-token", request: async () => new Response("{}", { status: 503 }) });
  assert.equal(failed.status, "UNAVAILABLE");
  setConfiguredPaperEndpoint("");
});

test("#661 cockpit has four isolated read-only modes and no LIVE action", () => {
  const cockpit = read("apps/mobile/src/paperShadowMonitorView.tsx");
  const liveView = read("apps/mobile/src/liveReadinessMonitorView.tsx");
  assert.match(cockpit, /BASE_MODES = \["PAPER", "SHADOW", "REAL"\]/);
  assert.match(cockpit, /"LIVE_READY"/);
  assert.match(cockpit, /LiveReadinessMonitorView/);
  assert.match(liveView, /testID="live-ready-monitor"/);
  assert.match(liveView, /주문·취소·출금·이체·LIVE 활성화/);
  for (const forbidden of ["onEnableLive", "createActivationLease", "activateLive", "submitOrder", "cancelOrder", "withdraw", "transfer"]) assert.equal(liveView.includes(forbidden), false, forbidden);
  assert.equal(/cash|equity|position|pnl/i.test(liveView), false, "LIVE_READY view must not perform accounting");
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /loadLiveReadinessOperations/);
  assert.match(app, /liveReadinessOperations/);
});

test("#661 wire contract rejects authority expansion and secret-shaped fields", () => {
  const payload = projectLiveReadinessObservabilitySnapshot(source().getSnapshot());
  assert.throws(() => validateLiveReadinessObservabilitySnapshot({ ...payload, productionMutationAllowed: true }), /authority invariant/);
  assert.throws(() => validateLiveReadinessObservabilitySnapshot({ ...payload, provenance: { ...payload.provenance, inputs: [{ ...payload.provenance.inputs[0], authorization: "Bearer x" }] } }), /prohibited|invalid/);
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ["orderrequest", "brokercredential", "leaseid", "authorization"]) assert.equal(serialized.includes(forbidden), false, forbidden);
});
