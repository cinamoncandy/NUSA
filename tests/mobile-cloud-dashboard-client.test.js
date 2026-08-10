const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadCloudDashboard,
  unavailableDashboardCredentialProvider
} = require("../dist/apps/mobile/src/cloudDashboardClient.js");

const dashboard = (overrides = {}) => ({
  apiVersion: "1",
  generatedAt: 1_000,
  mode: "PAPER",
  killSwitchActive: false,
  overallHealth: "HEALTHY",
  tradingAllowed: true,
  headline: "PAPER healthy",
  issues: [],
  deployableCapital: 1_000,
  deployedCapital: 500,
  cashCapital: 500,
  reservedCapital: 0,
  spotCapital: 500,
  futuresCapital: 0,
  positions: [],
  decisions: [],
  staleIntelligenceSources: [],
  ...overrides
});

function fakeFetch(status, body) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
  request.calls = calls;
  return request;
}

test("no credential provider fails closed as NOT_CONFIGURED without a network call", async () => {
  const request = fakeFetch(200, dashboard());
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: unavailableDashboardCredentialProvider,
    request
  });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(request.calls.length, 0);
});

test("a blank token is treated the same as no token", async () => {
  const request = fakeFetch(200, dashboard());
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "   ",
    request
  });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(request.calls.length, 0);
});

test("a non-loopback plain-HTTP endpoint fails closed as NOT_CONFIGURED", async () => {
  const request = fakeFetch(200, dashboard());
  const result = await loadCloudDashboard({
    baseUrl: "http://cloud.example.com:4300",
    credentialProvider: async () => "token-123",
    request
  });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(request.calls.length, 0);
});

test("loopback (127.0.0.1) over plain HTTP is allowed", async () => {
  const request = fakeFetch(200, dashboard());
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "token-123",
    request
  });
  assert.equal(result.status, "READY");
});

test("localhost over plain HTTP is allowed", async () => {
  const request = fakeFetch(200, dashboard());
  const result = await loadCloudDashboard({
    baseUrl: "http://localhost:4300/",
    credentialProvider: async () => "token-123",
    request
  });
  assert.equal(result.status, "READY");
});

test("bracketed IPv6 loopback ([::1]) over plain HTTP is allowed", async () => {
  const request = fakeFetch(200, dashboard());
  const result = await loadCloudDashboard({
    baseUrl: "http://[::1]:4300",
    credentialProvider: async () => "token-123",
    request
  });
  assert.equal(result.status, "READY");
});

test("a non-loopback HTTPS endpoint is allowed", async () => {
  const request = fakeFetch(200, dashboard());
  const result = await loadCloudDashboard({
    baseUrl: "https://cloud.example.com",
    credentialProvider: async () => "token-123",
    request
  });
  assert.equal(result.status, "READY");
});

test("a successful response is authorized with a Bearer token and returns the dashboard", async () => {
  const payload = dashboard({ headline: "custom headline" });
  const request = fakeFetch(200, payload);
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "secret-token",
    request
  });
  assert.equal(result.status, "READY");
  assert.equal(result.dashboard.headline, "custom headline");
  assert.equal(request.calls.length, 1);
  assert.equal(request.calls[0].url, "http://127.0.0.1:4300/api/dashboard");
  assert.equal(request.calls[0].init.method, "GET");
  assert.equal(request.calls[0].init.headers.authorization, "Bearer secret-token");
});

test("a trailing slash on baseUrl does not produce a double slash in the request URL", async () => {
  const request = fakeFetch(200, dashboard());
  await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300/",
    credentialProvider: async () => "token",
    request
  });
  assert.equal(request.calls[0].url, "http://127.0.0.1:4300/api/dashboard");
});

test("a 401 response is surfaced as UNAVAILABLE, not thrown", async () => {
  const request = fakeFetch(401, { error: "UNAUTHORIZED" });
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "bad-token",
    request
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /401/);
});

test("a real MobileDashboardResponse shape (string apiVersion, PAPER/STOPPED/FAULTED mode) is accepted", async () => {
  // The server's actual contract (packages/contracts/src/mobileDashboard.ts) types
  // apiVersion as the string "1", not a number, and mode as PAPER | STOPPED | FAULTED --
  // this pins that down against regressing back to a numeric/loose check.
  const request = fakeFetch(200, dashboard({ apiVersion: "1", mode: "STOPPED" }));
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "token",
    request
  });
  assert.equal(result.status, "READY");
});

test("a numeric apiVersion (wrong type per the real contract) is rejected as UNAVAILABLE", async () => {
  const request = fakeFetch(200, dashboard({ apiVersion: 1 }));
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "token",
    request
  });
  assert.equal(result.status, "UNAVAILABLE");
});

test("a malformed payload is rejected as UNAVAILABLE", async () => {
  const request = fakeFetch(200, { not: "a dashboard" });
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "token",
    request
  });
  assert.equal(result.status, "UNAVAILABLE");
});

test("a network failure is caught and surfaced as UNAVAILABLE", async () => {
  const request = async () => { throw new Error("ECONNREFUSED"); };
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:4300",
    credentialProvider: async () => "token",
    request
  });
  assert.equal(result.status, "UNAVAILABLE");
});
