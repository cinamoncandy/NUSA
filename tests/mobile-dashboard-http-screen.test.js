const test = require("node:test");
const assert = require("node:assert/strict");
const { handleMobileDashboardHttp } = require("../dist/apps/cloud/src/mobileDashboardHttp.js");
const { initialDashboardScreenState, resolveDashboardScreenState } = require("../dist/apps/mobile/src/dashboardScreenState.js");

const dashboard = (overrides = {}) => ({
  apiVersion: "1",
  generatedAt: 100,
  mode: "PAPER",
  killSwitchActive: false,
  overallHealth: "HEALTHY",
  tradingAllowed: true,
  headline: "정상 운용 중입니다.",
  issues: [],
  deployableCapital: 1000,
  deployedCapital: 400,
  cashCapital: 600,
  reservedCapital: 200,
  spotCapital: 250,
  futuresCapital: 150,
  positions: [],
  decisions: [],
  staleIntelligenceSources: [],
  ...overrides
});

const deps = (loadDashboard = () => dashboard()) => ({
  tokenVerifier: {
    verify(token) {
      if (token === "valid") return { userId: "owner-1", scopes: ["dashboard:read"] };
      if (token === "no-scope") return { userId: "owner-1", scopes: [] };
      return undefined;
    }
  },
  loadDashboard
});

test("requires bearer authentication and read scope", () => {
  assert.equal(handleMobileDashboardHttp({ method: "GET", headers: {} }, deps()).status, 401);
  assert.equal(handleMobileDashboardHttp({ method: "GET", headers: { authorization: "Bearer bad" } }, deps()).status, 401);
  assert.equal(handleMobileDashboardHttp({ method: "GET", headers: { authorization: "Bearer no-scope" } }, deps()).status, 403);
});

test("returns no-store dashboard response for authorized owner", () => {
  const response = handleMobileDashboardHttp({ method: "GET", headers: { authorization: "Bearer valid" } }, deps());
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  assert.equal(JSON.parse(response.body).headline, "정상 운용 중입니다.");
});

test("fails closed for unsupported methods and loader failures", () => {
  assert.equal(handleMobileDashboardHttp({ method: "POST", headers: { authorization: "Bearer valid" } }, deps()).status, 405);
  assert.equal(handleMobileDashboardHttp({ method: "GET", headers: { authorization: "Bearer valid" } }, deps(() => { throw new Error("down"); })).status, 503);
});

test("builds loading, ready, caution, blocked, and error screen states", () => {
  assert.equal(initialDashboardScreenState().phase, "LOADING");
  assert.equal(resolveDashboardScreenState(dashboard(), 100, 1000).phase, "READY");
  assert.equal(resolveDashboardScreenState(dashboard({ overallHealth: "DEGRADED", tradingAllowed: false, issues: ["Market data: DEGRADED"] }), 100, 1000).phase, "CAUTION");
  assert.equal(resolveDashboardScreenState(dashboard({ mode: "STOPPED", tradingAllowed: false }), 100, 1000).phase, "BLOCKED");
  assert.equal(resolveDashboardScreenState({ bad: true }, 100, 1000).phase, "ERROR");
});

test("screen never enables trading for kill switch or stale intelligence", () => {
  const stopped = resolveDashboardScreenState(dashboard({ killSwitchActive: true, tradingAllowed: false }), 100, 1000);
  assert.equal(stopped.canTrade, false);
  const stale = resolveDashboardScreenState(dashboard({ tradingAllowed: true, staleIntelligenceSources: ["NEWS"] }), 100, 1000);
  assert.equal(stale.phase, "CAUTION");
  assert.equal(stale.canTrade, false);
});
