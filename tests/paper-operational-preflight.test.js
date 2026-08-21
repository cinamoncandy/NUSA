const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  verifyRuntimeDeployment,
  verifyRuntimePaperReconciliation,
  createOperationalPaperRiskGate
} = require("../dist/apps/desktop/src/paper/paperOperationalPreflight.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { createSessionPeakEquityTracker } = require("../dist/apps/desktop/src/paper/paperRiskState.js");

function assets(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-preflight-"));
  const main = path.join(root, "main.js");
  const preload = path.join(root, "preload.js");
  const renderer = path.join(root, "index.html");
  for (const file of [main, preload, renderer]) fs.writeFileSync(file, "verified");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, main, renderer };
}

function deployment(t, overrides = {}) {
  const files = assets(t);
  return verifyRuntimeDeployment({
    mainDirectory: files.root,
    rendererPath: files.renderer,
    sourceCommitSha: "a".repeat(40),
    strategyId: "sma-crossover",
    strategyVersion: "sma-crossover:closed-candle-1m-v1",
    symbol: "KRW-BTC",
    interval: "1m",
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    ...overrides
  });
}

test("runtime deployment preflight passes only with executable assets and exact profile", (t) => {
  const result = deployment(t);
  assert.equal(result.status, "PASS");
  assert.equal(result.method, "RUNTIME_EXECUTABLE_ASSET_AND_PROFILE_CHECK");
  assert.ok(result.evidence.some((value) => value.startsWith("main.js:")));
});

test("runtime deployment preflight blocks missing asset and profile drift", (t) => {
  const files = assets(t);
  fs.unlinkSync(files.main);
  const missing = deployment(t, { mainDirectory: files.root, rendererPath: files.renderer });
  assert.equal(missing.status, "BLOCKED");
  assert.ok(missing.blockers.includes("REQUIRED_ASSET_MISSING:main.js"));
  const mismatch = deployment(t, { strategyId: "unapproved" });
  assert.equal(mismatch.status, "BLOCKED");
  assert.ok(mismatch.blockers.includes("STRATEGY_ID_MISMATCH"));
});

test("independent reconciliation passes for an empty paper ledger", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  const result = verifyRuntimePaperReconciliation({
    broker, initialCash: 1_000, markPrice: 100,
    persistenceHealthy: true,
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 }
  });
  assert.equal(result.status, "PASS");
});

test("reconciliation blocks account mismatch and any mutation counter", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  const original = broker.snapshot(100);
  broker.restoreState({ ...broker.exportState(), cash: 999 });
  const result = verifyRuntimePaperReconciliation({
    broker, initialCash: 1_000, markPrice: 100,
    persistenceHealthy: true,
    mutationCounters: { broker: 1, orders: 0, fills: 0, cash: 0, position: 0 }
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("CASH_MISMATCH"));
  assert.ok(result.blockers.includes("BROKER_MUTATION:1"));
  assert.equal(original.orders.length, 0);
});

test("shared risk gate is configured, but preflight failure remains fail-closed", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  const state = {
    deployment: { status: "PASS", method: "test", evidence: [], blockers: [] },
    reconciliation: { status: "PASS", method: "test", evidence: [], blockers: [] },
    riskGate: { status: "PASS", method: "test", evidence: [], blockers: [] }
  };
  const gate = createOperationalPaperRiskGate({
    getState: () => state,
    getBroker: () => broker,
    getMarket: () => ({ symbol: "KRW-BTC", price: 100, status: "HEALTHY" }),
    getControl: () => ({ killSwitchActive: false, openP0: false }),
    identity: { strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "p", seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set() },
    limits: { maxOrderNotional: 1_000, maxPositionNotional: 1_000, maxOpenOrders: 1, maxOrdersPerSecond: 1, maxOrdersPerMinute: 10, maxSameSideStreak: 5, maxSymbolExposureNotional: 1_000, maxPortfolioExposureNotional: 1_000, maxDailyBuyNotional: 1_000, maxDailySellNotional: 1_000, maxDailyLoss: 1_000, maxConsecutiveLosses: 3, maxSessionDrawdownRatio: 0.2, maxPriceDeviationRatio: 0.05 },
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }, sourceCommitSha: "a".repeat(40),
    sessionPeakEquity: createSessionPeakEquityTracker(1_000)
  });
  assert.equal(gate.evaluate({ path: "SHADOW", side: "BUY", quantity: 1, price: 100 }).status, "ALLOW");
  state.deployment.status = "BLOCKED";
  assert.equal(gate.evaluate({ path: "SHADOW", side: "BUY", quantity: 1, price: 100 }).status, "HALT");
});

test("Paper risk decisions are emitted as queryable evidence without changing the gate result", () => {
  const broker = new PaperBroker(1_000, "KRW-BTC", 0);
  const records = [];
  const state = {
    deployment: { status: "PASS", method: "test", evidence: [], blockers: [] },
    reconciliation: { status: "PASS", method: "test", evidence: [], blockers: [] },
    riskGate: { status: "PASS", method: "test", evidence: [], blockers: [] }
  };
  const gate = createOperationalPaperRiskGate({
    getState: () => state,
    getBroker: () => broker,
    getMarket: () => ({ symbol: "KRW-BTC", price: 100, status: "HEALTHY" }),
    getControl: () => ({ killSwitchActive: false, openP0: false }),
    identity: { strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "p", seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set() },
    limits: { maxOrderNotional: 1_000, maxPositionNotional: 1_000, maxOpenOrders: 1, maxOrdersPerSecond: 1, maxOrdersPerMinute: 10, maxSameSideStreak: 5, maxSymbolExposureNotional: 1_000, maxPortfolioExposureNotional: 1_000, maxDailyBuyNotional: 1_000, maxDailySellNotional: 1_000, maxDailyLoss: 1_000, maxConsecutiveLosses: 3, maxSessionDrawdownRatio: 0.2, maxPriceDeviationRatio: 0.05 },
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    sourceCommitSha: "a".repeat(40),
    sessionPeakEquity: createSessionPeakEquityTracker(1_000),
    evidence: { append(record) { records.push(record); } }
  });
  assert.equal(gate.evaluate({ path: "SHADOW", side: "BUY", quantity: 1, price: 100 }).status, "ALLOW");
  assert.equal(records.length, 1);
  assert.equal(records[0].result, "APPROVED");
  assert.equal(records[0].ruleId, "INDEPENDENT_PAPER_RISK_GATEWAY");
  assert.equal(records[0].marketState.symbol, "KRW-BTC");
  assert.equal(records[0].accountState.cash, 1_000);
  assert.equal(records[0].correlationId, records[0].inputParameters.requestId);
});
