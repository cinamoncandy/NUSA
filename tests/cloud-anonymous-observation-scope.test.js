const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  ANONYMOUS_OBSERVATION_ROUTES,
  anonymousObservationEnabled,
  isAnonymousObservationRoute
} = require("../dist/apps/cloud/src/observation/anonymousObservationScope.js");
const { buildMobileDashboardResponse } = require("../dist/apps/cloud/src/mobileDashboardApi.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");

function send(port, path, method = "GET", headers = {}, body = undefined) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { ...headers, connection: "close" } }, (res) => {
      let payload = "";
      res.on("data", (chunk) => { payload += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: payload }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const VALID_TOKEN = "owner-token";
const ownerPrincipal = Object.freeze({
  userId: "operator",
  email: "operator@nusa.local",
  scopes: Object.freeze(["dashboard:read", "paper:trade", "users:manage"])
});
const verifier = { ownerPrincipal, verify: (token) => (token === VALID_TOKEN ? ownerPrincipal : undefined) };

const dashboardPayload = () => buildMobileDashboardResponse({
  now: 1000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY",
  headline: "정상 운용 중입니다.", issues: [],
  portfolio: { allocations: [], deployedCapital: 0, cashCapital: 1000, reservedCapital: 0, grossShare: 0, futuresShare: 0, decidedAt: 1000 },
  decisions: [],
  intelligence: { signals: [], staleSources: [], generatedAt: 1000 }
});

const paperOperationsPayload = () => buildPersonalPaperOperationsSnapshot({
  dashboard: dashboardPayload(),
  research: null,
  operations: {
    runtimeState: "READY_OFFLINE", schedulerRunning: false, schedulerMode: "OFF",
    pipelineStage: "READ_ONLY", transport: "OFFLINE", killSwitchActive: false,
    accountHalted: false, pendingWrites: 0, updatedAt: 1000
  }
}, 1000);

// The flag is read when the server starts, so the module must be loaded after it is set.
async function withServer(anonymous, run, port) {
  const previous = process.env.NUSA_CLOUD_ANONYMOUS_OBSERVATION;
  if (anonymous) process.env.NUSA_CLOUD_ANONYMOUS_OBSERVATION = "1";
  else delete process.env.NUSA_CLOUD_ANONYMOUS_OBSERVATION;
  delete require.cache[require.resolve("../dist/apps/cloud/src/server.js")];
  const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
  const handle = startCloudDashboardServer({
    port,
    tokenVerifier: verifier,
    loadDashboard: () => dashboardPayload(),
    loadPaperOperations: () => paperOperationsPayload(),
    loadRealReadOnlyOperations: () => { throw new Error("REAL read-only snapshot must not be reached anonymously"); },
    submitPaperOrder: () => { throw new Error("PAPER order submission must not be reached anonymously"); },
    // Configured so the allocation route genuinely exists: a 404 from an unconfigured route
    // would not prove the boundary rejected the caller.
    investmentAllocationSettings: {
      get() { throw new Error("allocation settings must not be reached anonymously"); },
      save() { throw new Error("allocation settings must not be reached anonymously"); }
    }
  });
  try { await run(handle); }
  finally {
    await handle.stop();
    if (previous === undefined) delete process.env.NUSA_CLOUD_ANONYMOUS_OBSERVATION;
    else process.env.NUSA_CLOUD_ANONYMOUS_OBSERVATION = previous;
  }
}

test("the allowlist contains only read-only projections, never a credential or mutation route", () => {
  for (const route of ANONYMOUS_OBSERVATION_ROUTES) {
    assert.ok(!route.startsWith("/api/operator/"), `${route} issues or approves credentials`);
    assert.ok(!route.startsWith("/v1/mobile/") && !route.startsWith("/v1/desktop/"), `${route} is a session route`);
    assert.notEqual(route, "/api/real-readonly-operations");
    assert.notEqual(route, "/api/paper-orders");
    assert.notEqual(route, "/api/settings/investment-allocation");
    assert.notEqual(route, "/api/ux-telemetry");
  }
  assert.ok(ANONYMOUS_OBSERVATION_ROUTES.includes("/api/paper-operations"));
  assert.ok(isAnonymousObservationRoute("/api/dashboard"));
  assert.equal(isAnonymousObservationRoute("/api/operator/users"), false);
});

test("anonymous observation is off unless explicitly enabled", () => {
  assert.equal(anonymousObservationEnabled({}), false);
  assert.equal(anonymousObservationEnabled({ NUSA_CLOUD_ANONYMOUS_OBSERVATION: "0" }), false);
  assert.equal(anonymousObservationEnabled({ NUSA_CLOUD_ANONYMOUS_OBSERVATION: "true" }), false);
  assert.equal(anonymousObservationEnabled({ NUSA_CLOUD_ANONYMOUS_OBSERVATION: "1" }), true);
});

test("with the flag off, every allowlisted route still requires a bearer token", async () => {
  await withServer(false, async (handle) => {
    for (const route of ANONYMOUS_OBSERVATION_ROUTES) {
      const res = await send(handle.port, route);
      assert.equal(res.status, 401, `${route} must stay closed while the flag is off`);
    }
  }, 41871);
});

test("with the flag on, allowlisted read-only projections are served without a token", async () => {
  await withServer(true, async (handle) => {
    const dashboard = await send(handle.port, "/api/dashboard");
    assert.equal(dashboard.status, 200);
    assert.equal(JSON.parse(dashboard.body).mode, "PAPER");

    const paper = await send(handle.port, "/api/paper-operations");
    assert.equal(paper.status, 200);
  }, 41872);
});

test("with the flag on, the control surface stays closed to an anonymous caller", async () => {
  await withServer(true, async (handle) => {
    // REAL exchange balances are not PAPER data.
    assert.equal((await send(handle.port, "/api/real-readonly-operations")).status, 401);
    // Externally injected orders would make the autonomous fill/PnL evidence forgeable.
    assert.equal((await send(handle.port, "/api/paper-orders", "POST", { "content-type": "application/json" }, "{}")).status, 401);
    // Credential issuing and account management.
    assert.equal((await send(handle.port, "/api/operator/users")).status, 401);
    assert.equal((await send(handle.port, "/api/settings/investment-allocation")).status, 401);
  }, 41873);
});

test("with the flag on, an invalid token on an allowlisted route is still rejected", async () => {
  await withServer(true, async (handle) => {
    // Presenting a token means being judged on it; it must not fall back to anonymous access.
    const res = await send(handle.port, "/api/dashboard", "GET", { authorization: "Bearer not-the-owner-token" });
    assert.equal(res.status, 401);
    const valid = await send(handle.port, "/api/dashboard", "GET", { authorization: `Bearer ${VALID_TOKEN}` });
    assert.equal(valid.status, 200);
  }, 41874);
});
