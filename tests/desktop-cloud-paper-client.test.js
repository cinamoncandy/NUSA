const test = require("node:test");
const assert = require("node:assert/strict");
const { CloudPaperClient } = require("../dist/apps/desktop/src/cloud/cloudPaperClient.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");

const ACCESS_VALUE = "x".repeat(40);

const dashboard = (generatedAt) => ({
  apiVersion: "1",
  generatedAt,
  mode: "PAPER",
  killSwitchActive: false,
  overallHealth: "HEALTHY",
  tradingAllowed: true,
  headline: "PAPER healthy",
  issues: [],
  deployableCapital: 1_000,
  deployedCapital: 0,
  cashCapital: 1_000,
  reservedCapital: 0,
  spotCapital: 0,
  futuresCapital: 0,
  positions: [],
  decisions: [],
  staleIntelligenceSources: []
});

const operationsSnapshot = (generatedAt = Date.now()) => buildPersonalPaperOperationsSnapshot({
  dashboard: dashboard(generatedAt),
  research: null,
  ai: null,
  operations: {
    runtimeState: "READY",
    schedulerRunning: false,
    schedulerMode: "OFF",
    pipelineStage: "IDLE",
    transport: "ONLINE",
    killSwitchActive: false,
    accountHalted: false,
    pendingWrites: 0,
    updatedAt: generatedAt
  }
}, generatedAt);

const command = () => ({
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey: "paper-desktop-00000001",
  market: "KRW-BTC",
  side: "BUY",
  orderType: "MARKET",
  quantity: 0.001
});

const blockedResult = (submitted) => ({
  schemaVersion: 1,
  status: "BLOCKED",
  idempotencyKey: submitted.idempotencyKey,
  market: submitted.market,
  side: submitted.side,
  orderType: submitted.orderType,
  quantity: submitted.quantity,
  reason: "TEST_BLOCK",
  liveAuthority: "NONE",
  productionMutationAllowed: false
});

function secureSession(endpoint = "https://paper.example.test", accessToken = ACCESS_VALUE) {
  let current = true;
  const accessExpiresAt = Date.now() + 10 * 60_000;
  return {
    snapshot() {
      return current
        ? Object.freeze({ connected: true, endpoint, accessExpiresAt, refreshExpiresAt: Date.now() + 30 * 24 * 60 * 60_000 })
        : Object.freeze({ connected: false });
    },
    async lease() {
      if (!current) throw new Error("desktop cloud session unavailable");
      return Object.freeze({ endpoint, accessToken, accessExpiresAt });
    },
    isCurrent(lease) {
      return current && lease.endpoint === endpoint && lease.accessToken === accessToken && lease.accessExpiresAt === accessExpiresAt;
    },
    revokeForTest() { current = false; }
  };
}

function unconfiguredSession() {
  return {
    snapshot: () => Object.freeze({ connected: false }),
    async lease() { throw new Error("lease must not be requested"); },
    isCurrent: () => false
  };
}

test("Desktop secure-session status never exposes the leased access token", () => {
  const session = secureSession();
  const snapshot = session.snapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.endpoint, "https://paper.example.test");
  assert.equal(JSON.stringify(snapshot).includes(ACCESS_VALUE), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "accessToken"), false);
});

test("Desktop Cloud PAPER client performs no network request without a secure session", async () => {
  const session = unconfiguredSession();
  let calls = 0;
  const client = new CloudPaperClient({ session, request: async () => { calls += 1; throw new Error("must not call"); } });
  const read = await client.loadOperations();
  const write = await client.submitOrder(command());
  assert.equal(read.status, "NOT_CONFIGURED");
  assert.equal(write.status, "NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("Desktop reads only the canonical Cloud PAPER operations route with a secure access lease", async () => {
  const session = secureSession();
  const value = operationsSnapshot();
  let observedUrl = "";
  let observedInit;
  const client = new CloudPaperClient({
    session,
    request: async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return { ok: true, status: 200, redirected: false, url: "https://paper.example.test/api/paper-operations", json: async () => value };
    }
  });
  const result = await client.loadOperations();
  assert.equal(result.status, "READY");
  assert.equal(result.value.liveAuthority, "NONE");
  assert.equal(result.value.productionMutationAllowed, false);
  assert.equal(observedUrl, "https://paper.example.test/api/paper-operations");
  assert.equal(observedInit.method, "GET");
  assert.equal(observedInit.redirect, "error");
  assert.equal(observedInit.headers.authorization, `Bearer ${ACCESS_VALUE}`);
});

test("Desktop writes only to canonical Cloud PAPER orders with the submitted idempotency identity", async () => {
  const endpoint = "http://127.0.0.1:41731";
  const session = secureSession(endpoint);
  const submitted = command();
  let observedUrl = "";
  let observedInit;
  const client = new CloudPaperClient({
    session,
    request: async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return { ok: true, status: 200, redirected: false, url: `${endpoint}/api/paper-orders`, json: async () => blockedResult(submitted) };
    }
  });
  const result = await client.submitOrder(submitted);
  assert.equal(result.status, "READY");
  assert.equal(result.value.status, "BLOCKED");
  assert.equal(result.value.liveAuthority, "NONE");
  assert.equal(observedUrl, `${endpoint}/api/paper-orders`);
  assert.equal(observedInit.method, "POST");
  assert.equal(observedInit.redirect, "error");
  assert.equal(observedInit.headers.authorization, `Bearer ${ACCESS_VALUE}`);
  assert.equal(observedInit.headers["idempotency-key"], submitted.idempotencyKey);
  assert.deepEqual(JSON.parse(observedInit.body), submitted);
});

test("Desktop fails closed when the secure Cloud PAPER session changes while a request is in flight", async () => {
  const session = secureSession();
  const client = new CloudPaperClient({
    session,
    request: async () => {
      session.revokeForTest();
      return { ok: true, status: 200, redirected: false, url: "https://paper.example.test/api/paper-operations", json: async () => operationsSnapshot() };
    }
  });
  const result = await client.loadOperations();
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /session changed/i);
  assert.equal(session.snapshot().connected, false);
});

test("Desktop rejects Cloud PAPER redirects instead of following a leased credential to another endpoint", async () => {
  const session = secureSession();
  const client = new CloudPaperClient({
    session,
    request: async () => ({ ok: true, status: 200, redirected: true, url: "https://other.example.test/api/paper-operations", json: async () => operationsSnapshot() })
  });
  const result = await client.loadOperations();
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /redirect/i);
});
