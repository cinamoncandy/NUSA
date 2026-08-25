const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPersonalPaperOperationsSnapshot,
  validatePersonalPaperOperationsSnapshot
} = require("../dist/packages/contracts/src/personalPaperOperations.js");
const { handlePersonalPaperOperationsHttp } = require("../dist/apps/cloud/src/personalPaperOperationsHttp.js");
const {
  buildPersonalPaperOperationsEnvelope,
  validatePersonalPaperOperationsEnvelope
} = require("../dist/apps/desktop/src/paper/personalPaperOperationsAdapter.js");
const {
  loadPersonalPaperOperations,
  unavailableDashboardCredentialProvider
} = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const {
  clearConfiguredPaperEndpoint,
  markPaperConnectionVerified,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

const LOOPBACK_ENDPOINT = "http://127.0.0.1:41731";

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

const research = (overrides = {}) => ({
  sessionId: "session-1",
  state: "RUNNING",
  health: "HEALTHY",
  datasetId: "dataset-1",
  champion: { strategyId: "champion", strategyVersion: "1", authority: "PAPER_ONLY" },
  challenger: { strategyId: "challenger", strategyVersion: "2", authority: "ZERO_AUTHORITY" },
  candidateCount: 2,
  experimentCount: 5,
  metrics: {
    experimentCount: 5,
    positiveEvaluationCount: 3,
    negativeEvaluationCount: 2,
    cumulativeNetReturn: 0.1,
    averageNetReturn: 0.02,
    championBetterCount: 2,
    challengerBetterCount: 3,
    equivalentCount: 0,
    inconclusiveCount: 0,
    costAdjustedPerformance: 0.08
  },
  recoveryStatus: "READY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  ...overrides
});

const operations = (overrides = {}) => ({
  runtimeState: "READY",
  schedulerRunning: true,
  schedulerMode: "OBSERVE",
  pipelineStage: "MONITORING",
  transport: "ONLINE",
  killSwitchActive: false,
  accountHalted: false,
  pendingWrites: 0,
  lastEventAt: 1_000,
  updatedAt: 1_000,
  ...overrides
});

const snapshot = (overrides = {}) => buildPersonalPaperOperationsSnapshot({
  dashboard: dashboard(overrides.dashboard),
  research: overrides.research === null ? null : research(overrides.research),
  operations: operations(overrides.operations),
  paperLearning: overrides.paperLearning ?? null
}, 1_000);

test.beforeEach(() => clearConfiguredPaperEndpoint());
test.afterEach(() => clearConfiguredPaperEndpoint());

test("builds one immutable read-only PAPER operations snapshot", () => {
  const result = snapshot();
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.health, "HEALTHY");
  assert.equal(result.readyForPaperOperations, true);
  assert.equal(result.research.champion.authority, "PAPER_ONLY");
  assert.equal(result.research.challenger.authority, "ZERO_AUTHORITY");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.dashboard));
  assert.ok(Object.isFrozen(result.research));
});

test("carries bounded canonical PAPER learning evidence without granting authority", () => {
  const result = snapshot({ paperLearning: {
    schemaVersion: 1, mode: "PAPER", readOnly: true, liveAuthority: "NONE", productionMutationAllowed: false,
    runtimeStatus: "RUNNING", generatedAt: 1_000,
    events: [{ id: "cycle-event", cycleId: "cycle-1", mode: "PAPER", stage: "MARKET_DATA", occurredAt: 999, market: "KRW-BTC", status: "PASS", reason: "public ticker" }]
  } });
  assert.equal(result.paperLearning.runtimeStatus, "RUNNING");
  assert.equal(result.paperLearning.events[0].stage, "MARKET_DATA");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("fails closed on kill switch and Research fail-closed state", () => {
  assert.equal(snapshot({ dashboard: { killSwitchActive: true } }).health, "FAIL_CLOSED");
  assert.equal(snapshot({ research: { health: "FAIL_CLOSED", recoveryStatus: "FAIL_CLOSED" } }).health, "FAIL_CLOSED");
});

test("missing optional Research does not block fresh PAPER operations or create LIVE authority", () => {
  const result = snapshot({ research: null });
  assert.equal(result.health, "HEALTHY");
  assert.equal(result.readyForPaperOperations, true);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("validates freshness and rejects authority tampering", () => {
  const result = snapshot();
  assert.equal(validatePersonalPaperOperationsSnapshot(result, 1_100, 500).schemaVersion, 1);
  assert.throws(() => validatePersonalPaperOperationsSnapshot(result, 1_501, 500), /stale/);
  assert.throws(() => validatePersonalPaperOperationsSnapshot({ ...result, liveAuthority: "LIVE" }, 1_100, 500), /authority/);
});

test("authenticated endpoint is GET-only, scope-bound, and read-only", () => {
  const value = snapshot();
  const verifier = { verify: token => token === "ok" ? { userId: "owner", scopes: ["dashboard:read"] } : undefined };
  const loadSnapshot = () => value;
  const request = (method, authorization) => ({ method, headers: authorization ? { authorization } : {} });

  assert.equal(handlePersonalPaperOperationsHttp(request("GET"), { tokenVerifier: verifier, loadSnapshot }).status, 401);
  assert.equal(handlePersonalPaperOperationsHttp(request("POST", "Bearer ok"), { tokenVerifier: verifier, loadSnapshot }).status, 405);
  const forbidden = handlePersonalPaperOperationsHttp(request("GET", "Bearer ok"), {
    tokenVerifier: { verify: () => ({ userId: "owner", scopes: [] }) }, loadSnapshot
  });
  assert.equal(forbidden.status, 403);
  const ok = handlePersonalPaperOperationsHttp(request("GET", "Bearer ok"), { tokenVerifier: verifier, loadSnapshot });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).liveAuthority, "NONE");
});

test("desktop adapter uses the same contract and freezes the view", () => {
  const value = snapshot();
  const envelope = buildPersonalPaperOperationsEnvelope(value, 500, 1_100);
  assert.equal(envelope.authority, "READ_ONLY");
  assert.ok(Object.isFrozen(envelope));
  assert.ok(Object.isFrozen(envelope.snapshot));
  assert.equal(validatePersonalPaperOperationsEnvelope(envelope, 1_200).snapshot.liveAuthority, "NONE");
  assert.throws(() => validatePersonalPaperOperationsEnvelope(envelope, 1_501), /stale/);
});

test("mobile performs no request without a secure credential provider", async () => {
  let calls = 0;
  const result = await loadPersonalPaperOperations({
    baseUrl: LOOPBACK_ENDPOINT,
    credentialProvider: unavailableDashboardCredentialProvider,
    request: async () => { calls += 1; throw new Error("must not call"); }
  });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("mobile reads only the authenticated PAPER operations route after exact endpoint verification", async () => {
  const value = { ...snapshot(), generatedAt: Date.now() };
  setConfiguredPaperEndpoint(LOOPBACK_ENDPOINT);
  markPaperConnectionVerified(LOOPBACK_ENDPOINT);
  let observedUrl = "";
  let observedAuthorization = "";
  const result = await loadPersonalPaperOperations({
    baseUrl: `${LOOPBACK_ENDPOINT}/`,
    credentialProvider: async () => "secret",
    request: async (url, init) => {
      observedUrl = String(url);
      observedAuthorization = init.headers.authorization;
      return {
        ok: true,
        status: 200,
        redirected: false,
        url: `${LOOPBACK_ENDPOINT}/api/paper-operations`,
        json: async () => value
      };
    }
  });
  assert.equal(result.status, "READY");
  assert.equal(observedUrl, `${LOOPBACK_ENDPOINT}/api/paper-operations`);
  assert.equal(observedAuthorization, "Bearer secret");
  assert.equal(result.snapshot.liveAuthority, "NONE");
});
