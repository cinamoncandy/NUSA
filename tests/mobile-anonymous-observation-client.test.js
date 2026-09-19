const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  loadAnonymousPaperObservation,
  resolveObservationEndpoint
} = require("../dist/apps/mobile/src/observation/anonymousObservationClient.js");

const clientSource = fs.readFileSync(
  path.join(__dirname, "../apps/mobile/src/observation/anonymousObservationClient.ts"),
  "utf8"
);

const ENDPOINT = "https://paper.example.test";

function snapshotPayload() {
  const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const { buildMobileDashboardResponse } = require("../dist/apps/cloud/src/mobileDashboardApi.js");
  const now = Date.now();
  const dashboard = buildMobileDashboardResponse({
    now, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY",
    headline: "정상 운용 중입니다.", issues: [],
    portfolio: { allocations: [], deployedCapital: 0, cashCapital: 1000, reservedCapital: 0, grossShare: 0, futuresShare: 0, decidedAt: now },
    decisions: [],
    intelligence: { signals: [], staleSources: [], generatedAt: now }
  });
  return buildPersonalPaperOperationsSnapshot({
    dashboard,
    research: null,
    operations: {
      runtimeState: "READY_OFFLINE", schedulerRunning: false, schedulerMode: "OFF",
      pipelineStage: "READ_ONLY", transport: "OFFLINE", killSwitchActive: false,
      accountHalted: false, pendingWrites: 0, updatedAt: now
    }
  }, now);
}

function respond(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url: "",
    json: async () => body
  });
}

test("the client never attaches a credential", () => {
  // The whole point of the module. A regression here would send a session token to an endpoint
  // that was never verified, which is exactly what the credentialed client refuses to do.
  assert.doesNotMatch(clientSource, /authorization:\s*`Bearer/i);
  assert.doesNotMatch(clientSource, /credentialProvider/);
  assert.match(clientSource, /headers: \{ accept: "application\/json" \}/);
});

test("the client requests only the allowlisted read-only path", () => {
  assert.match(clientSource, /const OBSERVATION_PATH = "\/api\/paper-operations"/);
  assert.doesNotMatch(clientSource, /\/api\/operator\/|\/api\/paper-orders|real-readonly|investment-allocation/);
  assert.match(clientSource, /method: "GET"/);
  assert.doesNotMatch(clientSource, /method: "POST"|method: "PUT"|method: "DELETE"/);
});

test("no Authorization header reaches the network", async () => {
  let observedHeaders = null;
  const result = await loadAnonymousPaperObservation({
    baseUrl: ENDPOINT,
    request: async (_url, init) => {
      observedHeaders = init.headers;
      return { ok: true, status: 200, redirected: false, url: "", json: async () => snapshotPayload() };
    }
  });
  assert.equal(result.status, "READY");
  assert.ok(observedHeaders != null);
  const names = Object.keys(observedHeaders).map((name) => name.toLowerCase());
  assert.ok(!names.includes("authorization"), "an anonymous observation must carry no credential");
});

test("a server with anonymous observation disabled is reported, not retried with a credential", async () => {
  for (const status of [401, 403]) {
    const result = await loadAnonymousPaperObservation({ baseUrl: ENDPOINT, request: respond(status, {}) });
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.reason, /무인증 관측을 허용하지 않습니다/);
  }
});

test("plaintext remote endpoints are refused, loopback is allowed", () => {
  assert.equal(resolveObservationEndpoint({ baseUrl: "http://paper.example.test" }), null);
  assert.equal(resolveObservationEndpoint({ baseUrl: "https://paper.example.test/" }), "https://paper.example.test");
  assert.equal(resolveObservationEndpoint({ baseUrl: "http://localhost:8080" }), "http://localhost:8080");
  // Credentials embedded in the URL are a redirect vector, not a configuration.
  assert.equal(resolveObservationEndpoint({ baseUrl: "https://user:pw@paper.example.test" }), null);
});

test("an invalid projection is refused rather than rendered as fact", async () => {
  const result = await loadAnonymousPaperObservation({ baseUrl: ENDPOINT, request: respond(200, { not: "a snapshot" }) });
  assert.equal(result.status, "UNAVAILABLE");
});
