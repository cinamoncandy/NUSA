const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { RuntimeCommandService } = require("../dist/apps/desktop/src/runtimeCommandService.js");
const { buildPaperDashboardSections } = require("../dist/apps/desktop/src/paperDashboardProjection.js");
const { createCanonicalOperationalPaperRiskGate } = require("../dist/apps/desktop/src/paperOperationalPreflight.js");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/desktopPersistenceStore.js");
const { InMemoryRiskSafetyPersistence, CanonicalRiskSafetyGate } = require("../dist/apps/execution/src/risk-safety-integration.js");

const PASS = Object.freeze({ status: "PASS", method: "TEST", evidence: Object.freeze([]), blockers: Object.freeze([]) });
const NOW = 1_750_000_000_000;
const approval = (overrides = {}) => ({ approvalId: "approval-manual-1", approvedBy: "owner", approvedAtMs: NOW - 1_000, expiresAtMs: NOW + 60_000, mode: "PAPER", symbol: "KRW-BTC", strategyId: "MANUAL", policyFingerprint: "policy-1", ...overrides });

function buildGate({ persistence = new InMemoryRiskSafetyPersistence(), killSwitchActive = false, marketStatus = "HEALTHY", onDecision } = {}) {
  const broker = new PaperBroker(10_000, "KRW-BTC", 0);
  const state = { deployment: PASS, reconciliation: PASS, riskGate: PASS };
  const gate = createCanonicalOperationalPaperRiskGate({
    getState: () => state,
    getBroker: () => broker,
    getMarket: () => ({ symbol: "KRW-BTC", price: 100, status: marketStatus }),
    getControl: () => ({ killSwitchActive, openP0: false }),
    persistence,
    accountId: "desktop-paper",
    policyFingerprint: "policy-1",
    maxDailyLoss: 1_000,
    maxOpenOrders: 10,
    onDecision
  });
  return { broker, gate, persistence };
}

function serviceFor(gate, broker) {
  const control = new ControlPlane("sma-crossover");
  const strategy = { start() {}, stop() {}, isRunning: () => false, getStrategyId: () => "sma-crossover", restoreRunning() {} };
  return { service: new RuntimeCommandService(broker, control, strategy, { save() {} }, gate), control };
}

test("manual entry reaches canonical gate and Broker exactly once after explicit approval", () => {
  const built = buildGate();
  const canonical = new CanonicalRiskSafetyGate(built.persistence);
  canonical.saveApproval(approval());
  const { service } = serviceFor(built.gate, built.broker);
  const before = built.broker.exportState().orders.length;
  const order = service.manualOrder("BUY", 1, 100, { approvalId: "approval-manual-1", commandId: "manual-command-1", signalId: "manual-signal-1", clientOrderId: "manual-client-1", nowMs: NOW });
  assert.equal(order.side, "BUY");
  assert.equal(built.broker.exportState().orders.length, before + 1);
  assert.equal(built.persistence.listOrders("desktop-paper").length, 1);
});

test("strategy and reconnect replay entries use canonical approval and idempotency", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  new CanonicalRiskSafetyGate(persistence).saveApproval(approval({ approvalId: "approval-strategy-1", strategyId: "sma-crossover" }));
  const first = buildGate({ persistence });
  const { service } = serviceFor(first.gate, first.broker);
  const strategyOrder = service.replayOrder("BUY", 1, 100, { approvalId: "approval-strategy-1", strategyId: "sma-crossover", commandId: "replay-command-1", signalId: "replay-signal-1", clientOrderId: "replay-client-1", nowMs: NOW });
  assert.equal(strategyOrder.side, "BUY");
  const restarted = buildGate({ persistence });
  const { service: restartedService } = serviceFor(restarted.gate, restarted.broker);
  assert.throws(() => restartedService.replayOrder("BUY", 1, 100, { approvalId: "approval-strategy-1", strategyId: "sma-crossover", commandId: "replay-command-1", signalId: "replay-signal-1", clientOrderId: "replay-client-1", nowMs: NOW }), /DUPLICATE_COMMAND/);
});

test("SHADOW canonical evaluation never calls Broker, regardless of decision", () => {
  let calls = 0;
  const persistence = new InMemoryRiskSafetyPersistence();
  const canonical = new CanonicalRiskSafetyGate(persistence);
  const request = {
    accountId: "desktop-paper", requestId: "shadow-request-1", boundary: "SHADOW", mode: "SHADOW", symbol: "KRW-BTC", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW, currentEquity: 10_000,
    marketDataFresh: true, marketHealthy: true, killSwitchActive: false, liveMutationAllowed: false, recoveryReady: true, persistenceHealthy: true, maxDailyLoss: 1_000, maxOpenOrders: 10,
    idempotency: { accountId: "desktop-paper", commandId: "shadow-command-1", signalId: "shadow-signal-1", clientOrderId: "shadow-client-1", payloadFingerprint: "PENDING", createdAtMs: NOW }
  };
  const decision = canonical.evaluateAndSubmit(request, { submit() { calls += 1; } });
  assert.equal(decision.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("kill switch and canonical rejection prevent Broker execution", () => {
  const blocked = buildGate({ killSwitchActive: true });
  const { service: blockedService } = serviceFor(blocked.gate, blocked.broker);
  assert.throws(() => blockedService.manualOrder("BUY", 1, 100, { approvalId: "missing", commandId: "halt-command", signalId: "halt-signal", clientOrderId: "halt-client", nowMs: NOW }), /KILL_SWITCH_ACTIVE/);
  assert.equal(blocked.broker.exportState().orders.length, 0);
  const stale = buildGate({ marketStatus: "STALE" });
  const { service: staleService } = serviceFor(stale.gate, stale.broker);
  assert.throws(() => staleService.manualOrder("BUY", 1, 100, { approvalId: "missing", commandId: "stale-command", signalId: "stale-signal", clientOrderId: "stale-client", nowMs: NOW }), /MARKET_DATA_STALE/);
  assert.equal(stale.broker.exportState().orders.length, 0);
});

test("strategy automatic entry reaches canonical gate before Broker", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  new CanonicalRiskSafetyGate(persistence).saveApproval(approval({ approvalId: "approval-strategy-auto-1", strategyId: "sma-crossover" }));
  const built = buildGate({ persistence });
  const { service, control } = serviceFor(built.gate, built.broker);
  service.start();
  service.setAutoTrade(true);
  const result = service.automaticSignal("KRW-BTC", 100, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: NOW }, { approvalId: "approval-strategy-auto-1" });
  assert.equal(result.outcome, "FILLED");
  assert.equal(built.broker.exportState().orders.length, 1);
  assert.equal(built.persistence.listOrders("desktop-paper").length, 1);
});

test("Dashboard risk projection uses the last canonical decision and reason codes", () => {
  let last;
  const built = buildGate({ killSwitchActive: true, onDecision: (decision) => { last = decision; } });
  built.gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100, commandId: "dashboard-command", signalId: "dashboard-signal", clientOrderId: "dashboard-client", nowMs: NOW });
  const sections = buildPaperDashboardSections({
    account: built.broker.snapshot(100), control: new ControlPlane("sma-crossover").snapshot(), markPrice: 100, referenceEquity: 10_000, runtimeAvailable: true, generatedAt: NOW, canonicalRiskDecision: last
  });
  assert.equal(sections.risk.status, "BLOCKED");
  assert.deepEqual(sections.risk.reasons, last.reasonCodes);
});

test("runtime source has no direct Desktop Broker entrypoint bypass and uses canonical adapter", () => {
  const root = path.join(__dirname, "..", "apps", "desktop", "src");
  const main = fs.readFileSync(path.join(root, "main.ts"), "utf8");
  const service = fs.readFileSync(path.join(root, "runtimeCommandService.ts"), "utf8");
  assert.match(main, /createCanonicalOperationalPaperRiskGate/);
  assert.doesNotMatch(main, /createOperationalPaperRiskGate\(/);
  assert.ok(service.indexOf("this.requireRiskApproval") < service.indexOf("this.broker.execute"));
  assert.match(service, /RECONNECT_REPLAY/);
  assert.match(fs.readFileSync(path.join(root, "shadowOperationalRuntime.ts"), "utf8"), /path: "SHADOW"/);
});

test("Desktop SQLite migration persists canonical approval, day state, order state, and idempotency across restart", () => {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "nusa-risk-runtime-"));
  const file = path.join(root, "paper.sqlite");
  try {
    const first = new DesktopPersistenceStore(file);
    const repository = first.riskSafetyRepository();
    repository.saveApproval(approval());
    repository.saveDailyLoss({ accountId: "desktop-paper", tradingDay: "2025-06-15", dayStartEquity: 10_000, updatedAtMs: NOW });
    repository.saveOrder({ accountId: "desktop-paper", orderId: "order-1", status: "FILLED", updatedAtMs: NOW });
    repository.claimIdempotency({ accountId: "desktop-paper", commandId: "command-1", signalId: "signal-1", clientOrderId: "client-1", payloadFingerprint: "payload-1", createdAtMs: NOW });
    first.close();
    const restarted = new DesktopPersistenceStore(file);
    const restored = restarted.riskSafetyRepository();
    assert.equal(restored.loadApproval("approval-manual-1").approvalId, "approval-manual-1");
    assert.equal(restored.loadDailyLoss("desktop-paper").dayStartEquity, 10_000);
    assert.equal(restored.listOrders("desktop-paper")[0].status, "FILLED");
    assert.equal(restored.getIdempotency("desktop-paper", "command-1").clientOrderId, "client-1");
    restarted.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
