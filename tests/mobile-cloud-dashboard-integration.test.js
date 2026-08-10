const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloudDashboard, unavailableDashboardCredentialProvider } = require("../dist/apps/mobile/src/cloudDashboardClient");

const mockDashboard = (overrides = {}) => ({
  apiVersion: 1,
  mode: "READY",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  decisions: [],
  positions: [],
  staleIntelligenceSources: [],
  headline: "Normal operations",
  issues: [],
  deployableCapital: 1000000,
  deployedCapital: 500000,
  cashCapital: 500000,
  reservedCapital: 0,
  spotCapital: 500000,
  futuresCapital: 0,
  generatedAt: Date.now(),
  ...overrides
});

const mockFetch = (status, data) => async (url, options) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data
});

test("loadCloudDashboard returns NOT_CONFIGURED when credential provider returns null", async () => {
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: unavailableDashboardCredentialProvider
  });
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("loadCloudDashboard returns NOT_CONFIGURED when credential is empty", async () => {
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "   "
  });
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("loadCloudDashboard rejects non-loopback HTTP endpoints without HTTPS", async () => {
  const result = await loadCloudDashboard({
    baseUrl: "http://example.com:8080",
    credentialProvider: async () => "token123"
  });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.match(result.reason, /HTTPS/);
});

test("loadCloudDashboard accepts loopback HTTP (localhost, 127.0.0.1, [::1])", async () => {
  // Bare "::1" is not a valid URL host without brackets (new URL() would throw), so only
  // the bracketed IPv6 form is a real loopback URL here -- matching isSecureDashboardEndpoint.
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const result = await loadCloudDashboard({
      baseUrl: `http://${host}:8080`,
      credentialProvider: async () => "token123",
      request: mockFetch(200, mockDashboard())
    });
    assert.equal(result.status, "READY", `loopback ${host} should be allowed`);
  }
});

test("loadCloudDashboard returns UNAVAILABLE when HTTP response is not OK", async () => {
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "token123",
    request: mockFetch(503, { error: "server error" })
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /503/);
});

test("loadCloudDashboard returns UNAVAILABLE when response JSON is invalid", async () => {
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "token123",
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error("not JSON"); }
    })
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /connection/i);
});

test("loadCloudDashboard returns UNAVAILABLE when response schema is invalid", async () => {
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "token123",
    request: mockFetch(200, { apiVersion: "wrong", mode: "READY", decisions: [] })
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /Invalid/);
});

test("loadCloudDashboard returns READY with valid dashboard", async () => {
  const dashboard = mockDashboard({ mode: "RUNNING", tradingAllowed: false });
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "token123",
    request: mockFetch(200, dashboard)
  });
  assert.equal(result.status, "READY");
  assert.deepEqual(result.dashboard, dashboard);
  assert.equal(result.dashboard.mode, "RUNNING");
  assert.equal(result.dashboard.tradingAllowed, false);
});

test("loadCloudDashboard includes authorization header with Bearer token", async () => {
  let capturedHeaders;
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "secret-token-xyz",
    request: async (url, options) => {
      capturedHeaders = options.headers;
      return { ok: true, status: 200, json: async () => mockDashboard() };
    }
  });
  assert.equal(result.status, "READY");
  assert.equal(capturedHeaders.authorization, "Bearer secret-token-xyz");
  assert.equal(capturedHeaders.accept, "application/json");
});

test("loadCloudDashboard makes GET request to /api/dashboard", async () => {
  let capturedUrl, capturedMethod;
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "token",
    request: async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return { ok: true, status: 200, json: async () => mockDashboard() };
    }
  });
  assert.equal(result.status, "READY");
  assert.equal(capturedUrl, "http://127.0.0.1:8080/api/dashboard");
  assert.equal(capturedMethod, "GET");
});

test("loadCloudDashboard strips trailing slashes from base URL", async () => {
  let capturedUrl;
  await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080/////",
    credentialProvider: async () => "token",
    request: async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => mockDashboard() };
    }
  });
  assert.equal(capturedUrl, "http://127.0.0.1:8080/api/dashboard");
});

test("loadCloudDashboard handles network errors gracefully", async () => {
  const result = await loadCloudDashboard({
    baseUrl: "http://127.0.0.1:8080",
    credentialProvider: async () => "token",
    request: async () => { throw new Error("network timeout"); }
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /connection/i);
});
