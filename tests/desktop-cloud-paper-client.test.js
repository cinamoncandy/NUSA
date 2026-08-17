const test = require("node:test");
const assert = require("node:assert/strict");
const { CloudPaperAccessSession } = require("../dist/apps/desktop/src/cloudPaperAccessSession.js");
const { CloudPaperClient } = require("../dist/apps/desktop/src/cloudPaperClient.js");
const { buildPersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");

const TOKEN = "desktop-cloud-paper-access-token-00000001";

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

test("Desktop Cloud PAPER access is process-memory-only and never exposes the bearer in snapshots", () => {
  const session = new CloudPaperAccessSession();
  assert.throws(() => session.connect("http://192.168.1.5:41731", TOKEN), /insecure remote HTTP/i);
  assert.throws(() => session.connect("https://user:pass@paper.example.test", TOKEN), /credentials in URLs/i);
  const snapshot = session.connect("https://paper.example.test/", TOKEN);
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.endpoint, "https://paper.example.test");
  assert.equal(JSON.stringify(snapshot).includes(TOKEN), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "token"), false);
});

test("Desktop Cloud PAPER client performs no network request without an access session", async () => {
  const session = new CloudPaperAccessSession();
  let calls = 0;
  const client = new CloudPaperClient({ session, request: async () => { calls += 1; throw new Error("must not call"); } });
  const read = await client.loadOperations();
  const write = await client.submitOrder(command());
  assert.equal(read.status, "NOT_CONFIGURED");
  assert.equal(write.status, "NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("Desktop reads only the canonical Cloud PAPER operations route with the existing bearer contract", async () => {
  const session = new CloudPaperAccessSession();
  session.connect("https://paper.example.test", TOKEN);
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
  assert.equal(observedInit.headers.authorization, `Bearer ${TOKEN}`);
});

test("Desktop writes only to canonical Cloud PAPER orders with the submitted idempotency identity", async () => {
  const session = new CloudPaperAccessSession();
  session.connect("http://127.0.0.1:41731", TOKEN);
  const submitted = command();
  let observedUrl = "";
  let observedInit;
  const client = new CloudPaperClient({
    session,
    request: async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return { ok: true, status: 200, redirected: false, url: "http://127.0.0.1:41731/api/paper-orders", json: async () => blockedResult(submitted) };
    }
  });
  const result = await client.submitOrder(submitted);
  assert.equal(result.status, "READY");
  assert.equal(result.value.status, "BLOCKED");
  assert.equal(result.value.liveAuthority, "NONE");
  assert.equal(observedUrl, "http://127.0.0.1:41731/api/paper-orders");
  assert.equal(observedInit.method, "POST");
  assert.equal(observedInit.redirect, "error");
  assert.equal(observedInit.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(observedInit.headers["idempotency-key"], submitted.idempotencyKey);
  assert.deepEqual(JSON.parse(observedInit.body), submitted);
});

test("Desktop fails closed when the Cloud PAPER session changes while a request is in flight", async () => {
  const session = new CloudPaperAccessSession();
  session.connect("https://paper.example.test", TOKEN);
  const client = new CloudPaperClient({
    session,
    request: async () => {
      session.clear();
      return { ok: true, status: 200, redirected: false, url: "https://paper.example.test/api/paper-operations", json: async () => operationsSnapshot() };
    }
  });
  const result = await client.loadOperations();
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /session changed/i);
  assert.equal(session.snapshot().configured, false);
});

test("Desktop rejects Cloud PAPER redirects instead of following credentials to another endpoint", async () => {
  const session = new CloudPaperAccessSession();
  session.connect("https://paper.example.test", TOKEN);
  const client = new CloudPaperClient({
    session,
    request: async () => ({ ok: true, status: 200, redirected: true, url: "https://other.example.test/api/paper-operations", json: async () => operationsSnapshot() })
  });
  const result = await client.loadOperations();
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /redirect/i);
});
