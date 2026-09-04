const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { ControlPlane } = require("../dist/apps/desktop/src/control/controlPlane.js");
const { RuntimeCommandService } = require("../dist/apps/desktop/src/control/runtimeCommandService.js");
const { buildPaperDashboardSections } = require("../dist/apps/desktop/src/paper/paperDashboardProjection.js");
const { createCanonicalOperationalPaperRiskGate } = require("../dist/apps/desktop/src/paper/paperOperationalPreflight.js");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
const { InMemoryRiskSafetyPersistence, CanonicalRiskSafetyGate } = require("../dist/apps/execution/src/risk-safety-integration.js");
const { PaperApprovalService } = require("../dist/apps/desktop/src/paper/paperApprovalService.js");
const { InMemoryRiskEvidenceSink } = require("../dist/apps/execution/src/global-risk-gateway.js");

const PASS = Object.freeze({ status: "PASS", method: "TEST", evidence: Object.freeze([]), blockers: Object.freeze([]) });
const NOW = 1_750_000_000_000;
const FINGERPRINTS = Object.freeze({ strategy: "fp-strategy", config: "fp-config", runtime: "fp-runtime", riskPolicy: "policy-1" });
// Generous independent-gateway limits by default: tests that want to exercise a specific
// independent-gateway limit override just that one field.
const DEFAULT_LIMITS = Object.freeze({
  maxOrderNotional: 1_000_000, maxPositionNotional: 1_000_000, maxOpenOrders: 10, maxOrdersPerSecond: 100,
  maxOrdersPerMinute: 1000, maxSameSideStreak: 100, maxSymbolExposureNotional: 1_000_000, maxPortfolioExposureNotional: 1_000_000,
  maxDailyBuyNotional: 1_000_000, maxDailySellNotional: 1_000_000, maxDailyLoss: 1_000_000, maxConsecutiveLosses: 100,
  maxSessionDrawdownRatio: 1, maxPriceDeviationRatio: 1
});

function createSessionPeakEquityTracker(initial) {
  let peak = initial;
  return { observe(equity) { if (equity > peak) peak = equity; return peak; } };
}

/**
 * Builds the exact production gate (createCanonicalOperationalPaperRiskGate: independent
 * gateway -> canonical gate -> dual+composite evidence) with real InMemory backends, mirroring
 * apps/desktop/src/main.ts's wiring field-for-field.
 */
function buildGate({ persistence = new InMemoryRiskSafetyPersistence(), killSwitchActive = false, marketStatus = "HEALTHY", onDecision, limits = DEFAULT_LIMITS, evidence } = {}) {
  const broker = new PaperBroker(10_000, "KRW-BTC", 0);
  const state = { deployment: PASS, reconciliation: PASS, riskGate: PASS };
  const identity = { strategyFingerprint: FINGERPRINTS.strategy, configFingerprint: FINGERPRINTS.config, runtimeFingerprint: FINGERPRINTS.runtime, riskPolicyFingerprint: FINGERPRINTS.riskPolicy, seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set() };
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
    identity,
    limits,
    sessionPeakEquity: createSessionPeakEquityTracker(10_000),
    fingerprints: FINGERPRINTS,
    sourceCommitSha: "test-commit",
    evidence,
    onDecision
  });
  const approvals = new PaperApprovalService(new CanonicalRiskSafetyGate(persistence));
  return { broker, gate, persistence, approvals };
}

function serviceFor(gate, broker) {
  const control = new ControlPlane("sma-crossover");
  const strategy = { start() {}, stop() {}, isRunning: () => false, getStrategyId: () => "sma-crossover", restoreRunning() {} };
  return { service: new RuntimeCommandService(broker, control, strategy, { save() {} }, gate), control };
}

/** Mirrors exactly what main.ts's paper:order IPC handler does: mint a commandId, issue the manual approval through PaperApprovalService, then place the order with that approvalId+commandId. Never fabricates an approvalId. */
function placeManualOrderLikeIpcHandler({ service, approvals, side, quantity, price, nowMs = NOW, symbol = "KRW-BTC" }) {
  const commandId = `manual:${nowMs}:${Math.random().toString(36).slice(2)}`;
  const approval = approvals.issueManualApproval({ symbol, side, commandId, policyFingerprint: "policy-1", nowMs });
  return service.manualOrder(side, quantity, price, { approvalId: approval.approvalId, commandId, signalId: commandId, clientOrderId: `paper:${commandId}`, nowMs });
}

test("manual entry issued through PaperApprovalService (as the real paper:order handler does) reaches canonical gate and Broker exactly once", () => {
  const built = buildGate();
  const { service } = serviceFor(built.gate, built.broker);
  const before = built.broker.exportState().orders.length;
  const order = placeManualOrderLikeIpcHandler({ service, approvals: built.approvals, side: "BUY", quantity: 1, price: 100 });
  assert.equal(order.side, "BUY");
  assert.equal(built.broker.exportState().orders.length, before + 1);
  assert.equal(built.persistence.listOrders("desktop-paper").length, 1);
});

test("manual order without any approval is rejected with APPROVAL_MISSING and never reaches Broker", () => {
  const built = buildGate();
  const { service } = serviceFor(built.gate, built.broker);
  assert.throws(() => service.manualOrder("BUY", 1, 100, { commandId: "no-approval-command", signalId: "no-approval-signal", clientOrderId: "no-approval-client", nowMs: NOW }), /APPROVAL_MISSING/);
  assert.equal(built.broker.exportState().orders.length, 0);
});

test("a manual approval is single-use: the same approvalId cannot cover a second, different order", () => {
  const built = buildGate();
  const { service } = serviceFor(built.gate, built.broker);
  const commandId = "manual-single-use-1";
  const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId, policyFingerprint: "policy-1", nowMs: NOW });
  service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId, signalId: commandId, clientOrderId: `paper:${commandId}`, nowMs: NOW });
  assert.equal(built.broker.exportState().orders.length, 1);
  // A second order, with a different commandId, presents the SAME approvalId. The approval is
  // bound to the first commandId, so this is APPROVAL_SCOPE_MISMATCH, not a second fill.
  assert.throws(() => service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId: "manual-single-use-2", signalId: "manual-single-use-2", clientOrderId: "paper:manual-single-use-2", nowMs: NOW + 1 }), /APPROVAL_SCOPE_MISMATCH/);
  assert.equal(built.broker.exportState().orders.length, 1);
});

test("changing side after a manual approval was issued invalidates it (APPROVAL_SCOPE_MISMATCH)", () => {
  const built = buildGate();
  const { service } = serviceFor(built.gate, built.broker);
  const commandId = "manual-side-mismatch";
  // Approval issued for SELL; the order actually attempted is BUY. (Attempting a bare SELL
  // with no position first would fail the independent gateway's INSUFFICIENT_POSITION check
  // before ever reaching the canonical scope check this test is about, so this direction
  // isolates the scope mismatch cleanly.)
  const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "SELL", commandId, policyFingerprint: "policy-1", nowMs: NOW });
  assert.throws(() => service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId, signalId: commandId, clientOrderId: `paper:${commandId}`, nowMs: NOW }), /APPROVAL_SCOPE_MISMATCH/);
  assert.equal(built.broker.exportState().orders.length, 0);
});

test("a manual approval expires after its 60-second TTL and fails closed", () => {
  const built = buildGate();
  const { service } = serviceFor(built.gate, built.broker);
  const commandId = "manual-expiry-1";
  const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId, policyFingerprint: "policy-1", nowMs: NOW });
  assert.throws(() => service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId, signalId: commandId, clientOrderId: `paper:${commandId}`, nowMs: NOW + 60_001 }), /APPROVAL_EXPIRED/);
  assert.equal(built.broker.exportState().orders.length, 0);
});

test("strategy approval issued through PaperApprovalService (as control:start does) allows automatic orders; restart never auto-recovers it", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const built = buildGate({ persistence });
  const { service } = serviceFor(built.gate, built.broker);
  // Mirrors control:start: an explicit "start" action issues a fresh STRATEGY approval.
  const approval = built.approvals.issueStrategyApproval({ symbol: "KRW-BTC", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW });
  service.start();
  service.setAutoTrade(true);
  const result = service.automaticSignal("KRW-BTC", 100, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: NOW }, { approvalId: approval.approvalId });
  assert.equal(result.outcome, "FILLED");
  assert.equal(built.broker.exportState().orders.length, 1);

  // Simulate a process restart: a brand-new gate/service pair over the SAME persisted approval
  // table, but -- exactly like main.ts's currentStrategyApprovalId being reset to undefined on
  // every boot -- automaticSignal is called with NO approvalId at all.
  const restarted = buildGate({ persistence });
  const { service: restartedService } = serviceFor(restarted.gate, restarted.broker);
  restartedService.start();
  restartedService.setAutoTrade(true);
  const afterRestart = restartedService.automaticSignal("KRW-BTC", 100, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: NOW + 1 });
  assert.equal(afterRestart.outcome, "REJECTED");
  assert.match(afterRestart.error, /APPROVAL_MISSING/);
  assert.equal(restarted.broker.exportState().orders.length, 0);
});

test("revoking a strategy approval (as control:stop / kill-switch activation does) blocks any further automatic order under it", () => {
  const built = buildGate();
  const { service } = serviceFor(built.gate, built.broker);
  const approval = built.approvals.issueStrategyApproval({ symbol: "KRW-BTC", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW });
  service.start();
  service.setAutoTrade(true);
  built.approvals.revoke(approval.approvalId, "STRATEGY_STOPPED");
  const result = service.automaticSignal("KRW-BTC", 100, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: NOW + 1 }, { approvalId: approval.approvalId });
  assert.equal(result.outcome, "REJECTED");
  assert.match(result.error, /APPROVAL_MISSING/);
  assert.equal(built.broker.exportState().orders.length, 0);
});

test("reconnect replay entries use canonical approval and idempotency, and reject an exact replay after restart", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const approvals = new PaperApprovalService(new CanonicalRiskSafetyGate(persistence));
  const strategyApprovalId = approvals.issueStrategyApproval({ symbol: "KRW-BTC", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW }).approvalId;
  const first = buildGate({ persistence });
  const { service } = serviceFor(first.gate, first.broker);
  const strategyOrder = service.replayOrder("BUY", 1, 100, { approvalId: strategyApprovalId, strategyId: "sma-crossover", commandId: "replay-command-1", signalId: "replay-signal-1", clientOrderId: "replay-client-1", nowMs: NOW });
  assert.equal(strategyOrder.side, "BUY");
  const restarted = buildGate({ persistence });
  const { service: restartedService } = serviceFor(restarted.gate, restarted.broker);
  assert.throws(() => restartedService.replayOrder("BUY", 1, 100, { approvalId: strategyApprovalId, strategyId: "sma-crossover", commandId: "replay-command-1", signalId: "replay-signal-1", clientOrderId: "replay-client-1", nowMs: NOW }), /DUPLICATE_COMMAND/);
});

test("SHADOW canonical evaluation never calls Broker, regardless of decision", () => {
  let calls = 0;
  const persistence = new InMemoryRiskSafetyPersistence();
  const canonical = new CanonicalRiskSafetyGate(persistence);
  const request = {
    accountId: "desktop-paper", requestId: "shadow-request-1", boundary: "SHADOW", mode: "SHADOW", symbol: "KRW-BTC", side: "BUY", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW, currentEquity: 10_000,
    marketDataFresh: true, marketHealthy: true, killSwitchActive: false, liveMutationAllowed: false, recoveryReady: true, persistenceHealthy: true, maxDailyLoss: 1_000, maxOpenOrders: 10,
    idempotency: { accountId: "desktop-paper", commandId: "shadow-command-1", signalId: "shadow-signal-1", clientOrderId: "shadow-client-1", payloadFingerprint: "PENDING", createdAtMs: NOW }
  };
  const decision = canonical.evaluateAndSubmit(request, { submit() { calls += 1; } });
  assert.equal(decision.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("kill switch active blocks Broker execution regardless of approval; stale market data does too", () => {
  const blocked = buildGate({ killSwitchActive: true });
  const { service: blockedService } = serviceFor(blocked.gate, blocked.broker);
  const approval = blocked.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "halt-command", policyFingerprint: "policy-1", nowMs: NOW });
  assert.throws(() => blockedService.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId: "halt-command", signalId: "halt-signal", clientOrderId: "halt-client", nowMs: NOW }), /KILL_SWITCH_ACTIVE/);
  assert.equal(blocked.broker.exportState().orders.length, 0);
  const stale = buildGate({ marketStatus: "STALE" });
  const { service: staleService } = serviceFor(stale.gate, stale.broker);
  assert.throws(() => staleService.manualOrder("BUY", 1, 100, { commandId: "stale-command", signalId: "stale-signal", clientOrderId: "stale-client", nowMs: NOW }), /MARKET_DATA_STALE/);
  assert.equal(stale.broker.exportState().orders.length, 0);
});

// ---------------------------------------------------------------------------------------------
// WO-0019: gate chaining (independent gateway first, canonical second)
// ---------------------------------------------------------------------------------------------

test("an independent-gateway rejection blocks Broker AND never reaches the canonical gate (no idempotency key is claimed)", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const built = buildGate({ persistence, limits: { ...DEFAULT_LIMITS, maxOrderNotional: 50 } }); // 1 * price(100) = 100 notional > 50
  const { service } = serviceFor(built.gate, built.broker);
  const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "independent-block-1", policyFingerprint: "policy-1", nowMs: NOW });
  assert.throws(() => service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId: "independent-block-1", signalId: "independent-block-1", clientOrderId: "paper:independent-block-1", nowMs: NOW }), /MAX_ORDER_NOTIONAL/);
  assert.equal(built.broker.exportState().orders.length, 0);
  // The canonical gate was never invoked, so it never claimed this commandId as an idempotency
  // key -- proving the independent rejection did not "spend" it.
  assert.equal(persistence.getIdempotency("desktop-paper", "independent-block-1"), undefined);
});

for (const [name, limits] of [
  ["MAX_SYMBOL_EXPOSURE", { ...DEFAULT_LIMITS, maxSymbolExposureNotional: 10 }],
  ["MAX_PORTFOLIO_EXPOSURE", { ...DEFAULT_LIMITS, maxPortfolioExposureNotional: 10 }],
  ["SESSION_DRAWDOWN_LIMIT", { ...DEFAULT_LIMITS, maxSessionDrawdownRatio: 0 }],
  ["MAX_DAILY_BUY_NOTIONAL", { ...DEFAULT_LIMITS, maxDailyBuyNotional: 10 }],
  ["ORDER_RATE_LIMIT_PER_SECOND", { ...DEFAULT_LIMITS, maxOrdersPerSecond: 0 }],
  ["ORDER_RATE_LIMIT_PER_MINUTE", { ...DEFAULT_LIMITS, maxOrdersPerMinute: 0 }]
]) {
  test(`independent gateway limit ${name} blocks the order before the canonical gate/Broker`, () => {
    const built = buildGate({ limits });
    const { service } = serviceFor(built.gate, built.broker);
    const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: `limit-${name}`, policyFingerprint: "policy-1", nowMs: NOW });
    assert.throws(() => service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId: `limit-${name}`, signalId: `limit-${name}`, clientOrderId: `paper:limit-${name}`, nowMs: NOW }), new RegExp(name));
    assert.equal(built.broker.exportState().orders.length, 0);
  });
}

test("MAX_PRICE_DEVIATION and MAX_CONSECUTIVE_LOSSES limits are declared and enforced by the underlying independent gateway", () => {
  // These two depend on session/ledger history the gate derives from the broker rather than a
  // single-order snapshot; independent-risk-gateway.test.js exercises evaluatePreTradeRisk
  // directly for every declared reason code, including these two. This test only confirms the
  // limits this wiring restores are the same ones that module declares.
  const { RISK_REASON_ORDER } = require("../dist/apps/desktop/src/risk/independentRiskGateway.js");
  assert.ok(RISK_REASON_ORDER.includes("PRICE_DEVIATION_LIMIT"));
  assert.ok(RISK_REASON_ORDER.includes("CONSECUTIVE_LOSS_LIMIT"));
});

// ---------------------------------------------------------------------------------------------
// WO-0019: dual risk evidence (INDEPENDENT_*, CANONICAL_*, COMPOSITE_*)
// ---------------------------------------------------------------------------------------------

test("an approved order writes INDEPENDENT_*, CANONICAL_*, and a COMPOSITE_APPROVED evidence record, in that order, before Broker is called", () => {
  const evidence = new InMemoryRiskEvidenceSink();
  const built = buildGate({ evidence });
  const { service } = serviceFor(built.gate, built.broker);
  const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "evidence-approved-1", policyFingerprint: "policy-1", nowMs: NOW });
  service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId: "evidence-approved-1", signalId: "evidence-approved-1", clientOrderId: "paper:evidence-approved-1", nowMs: NOW });
  const records = evidence.list();
  assert.equal(records.length, 3);
  assert.equal(records[0].ruleId, "INDEPENDENT_PAPER_RISK_GATEWAY");
  assert.equal(records[0].result, "APPROVED");
  assert.equal(records[1].ruleId, "CANONICAL_RISK_SAFETY_GATE");
  assert.equal(records[1].result, "APPROVED");
  assert.equal(records[2].ruleId, "COMPOSITE_APPROVED");
  assert.equal(records[2].result, "APPROVED");
});

test("an independent-gateway block writes INDEPENDENT_* and COMPOSITE_BLOCKED evidence, never a CANONICAL_* record", () => {
  const evidence = new InMemoryRiskEvidenceSink();
  const built = buildGate({ evidence, limits: { ...DEFAULT_LIMITS, maxOrderNotional: 50 } });
  const { service } = serviceFor(built.gate, built.broker);
  const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "evidence-independent-block", policyFingerprint: "policy-1", nowMs: NOW });
  assert.throws(() => service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId: "evidence-independent-block", signalId: "evidence-independent-block", clientOrderId: "paper:evidence-independent-block", nowMs: NOW }));
  const records = evidence.list();
  assert.equal(records.length, 2);
  assert.equal(records[0].ruleId, "INDEPENDENT_PAPER_RISK_GATEWAY");
  assert.ok(!records.some((record) => record.ruleId === "CANONICAL_RISK_SAFETY_GATE"));
  assert.equal(records[1].ruleId, "COMPOSITE_BLOCKED");
});

test("a canonical-gate block (missing approval) writes INDEPENDENT_*, CANONICAL_*, and COMPOSITE_BLOCKED evidence", () => {
  const evidence = new InMemoryRiskEvidenceSink();
  const built = buildGate({ evidence });
  const { service } = serviceFor(built.gate, built.broker);
  assert.throws(() => service.manualOrder("BUY", 1, 100, { commandId: "evidence-canonical-block", signalId: "evidence-canonical-block", clientOrderId: "paper:evidence-canonical-block", nowMs: NOW }), /APPROVAL_MISSING/);
  const records = evidence.list();
  assert.equal(records.length, 3);
  assert.equal(records[1].ruleId, "CANONICAL_RISK_SAFETY_GATE");
  assert.equal(records[1].result, "BLOCKED");
  assert.equal(records[2].ruleId, "COMPOSITE_BLOCKED");
});

test("an evidence write failure fails the order closed with PERSISTENCE_UNHEALTHY, even though both gates would otherwise approve", () => {
  const throwingEvidence = { append() { throw new Error("disk full"); } };
  const built = buildGate({ evidence: throwingEvidence });
  const { service } = serviceFor(built.gate, built.broker);
  const approval = built.approvals.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "evidence-write-fails", policyFingerprint: "policy-1", nowMs: NOW });
  assert.throws(() => service.manualOrder("BUY", 1, 100, { approvalId: approval.approvalId, commandId: "evidence-write-fails", signalId: "evidence-write-fails", clientOrderId: "paper:evidence-write-fails", nowMs: NOW }), /PERSISTENCE_UNHEALTHY/);
  assert.equal(built.broker.exportState().orders.length, 0);
});

test("strategy automatic entry issued through PaperApprovalService reaches canonical gate before Broker", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const built = buildGate({ persistence });
  const { service } = serviceFor(built.gate, built.broker);
  const approval = built.approvals.issueStrategyApproval({ symbol: "KRW-BTC", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW });
  service.start();
  service.setAutoTrade(true);
  const result = service.automaticSignal("KRW-BTC", 100, 0, { type: "BUY", reason: "test", confidence: 1, timestamp: NOW }, { approvalId: approval.approvalId });
  assert.equal(result.outcome, "FILLED");
  assert.equal(built.broker.exportState().orders.length, 1);
  assert.equal(built.persistence.listOrders("desktop-paper").length, 1);
});

test("Dashboard risk projection separates the real kill switch from the last composite decision, and surfaces reasonCodes", () => {
  let last;
  const built = buildGate({ killSwitchActive: false, onDecision: (decision) => { last = decision; } });
  built.gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100, commandId: "dashboard-command", signalId: "dashboard-signal", clientOrderId: "dashboard-client", nowMs: NOW });
  const sections = buildPaperDashboardSections({
    account: built.broker.snapshot(100), control: new ControlPlane("sma-crossover").snapshot(), markPrice: 100, referenceEquity: 10_000, runtimeAvailable: true, generatedAt: NOW,
    canonicalRiskDecision: last, killSwitchActive: false
  });
  assert.equal(sections.risk.status, "BLOCKED");
  assert.deepEqual(sections.risk.reasons, last.reasonCodes);
  // The order above was blocked for APPROVAL_MISSING, not the kill switch -- the real switch
  // (explicitly false here) must not be reported as active just because SOME risk gate blocked.
  assert.equal(sections.risk.killSwitchActive, false);
  assert.equal(sections.risk.lastRiskDecision.status, last.status);
  assert.deepEqual(sections.risk.lastRiskDecision.reasonCodes, last.reasonCodes);
  assert.equal(sections.risk.lastRiskDecision.gate, "COMPOSITE");
});

test("Dashboard risk projection reports killSwitchActive true only when the real switch is active", () => {
  const built = buildGate({ killSwitchActive: true });
  built.gate.evaluate({ path: "MANUAL", side: "BUY", quantity: 1, price: 100, commandId: "dashboard-kill-command", signalId: "dashboard-kill-signal", clientOrderId: "dashboard-kill-client", nowMs: NOW });
  const sections = buildPaperDashboardSections({
    account: built.broker.snapshot(100), control: new ControlPlane("sma-crossover").snapshot(), markPrice: 100, referenceEquity: 10_000, runtimeAvailable: true, generatedAt: NOW, killSwitchActive: true
  });
  assert.equal(sections.risk.killSwitchActive, true);
});

test("runtime source wires MANUAL/STRATEGY approval issuance through PaperApprovalService, kill-switch audit before state change, and the canonical adapter -- never a fabricated approvalId", () => {
  const root = path.join(__dirname, "..", "apps", "desktop", "src");
  const main = fs.readFileSync(path.join(root, "main.ts"), "utf8");
  const service = fs.readFileSync(path.join(root, "control", "runtimeCommandService.ts"), "utf8");
  // apps/desktop/src/paper/paperApprovalService.ts is a re-export shim; the real source lives
  // in packages/core, shared with apps/cloud/src.
  const approvalService = fs.readFileSync(path.join(root, "..", "..", "..", "packages", "core", "src", "paperApprovalService.ts"), "utf8");
  // The ipcMain.handle(...) registrations that used to be inline in main.ts now live in these
  // per-domain files.
  const paperIpc = fs.readFileSync(path.join(root, "ipc", "registerPaperIpcHandlers.ts"), "utf8");
  const controlIpc = fs.readFileSync(path.join(root, "ipc", "registerControlIpcHandlers.ts"), "utf8");
  const safetyIpc = fs.readFileSync(path.join(root, "ipc", "registerSafetyIpcHandlers.ts"), "utf8");
  assert.match(main, /createCanonicalOperationalPaperRiskGate/);
  assert.doesNotMatch(main, /createOperationalPaperRiskGate\(/);
  assert.ok(service.indexOf("this.requireRiskApproval") < service.indexOf("this.broker.execute"));
  assert.match(service, /RECONNECT_REPLAY/);
  assert.match(fs.readFileSync(path.join(root, "shadow", "shadowOperationalRuntime.ts"), "utf8"), /path: "SHADOW"/);
  // MANUAL: paper:order issues through PaperApprovalService, not a literal approvalId.
  assert.match(paperIpc, /paperApprovalService\.issueManualApproval/);
  // STRATEGY: control:start issues through PaperApprovalService, and control:stop revokes.
  assert.match(controlIpc, /paperApprovalService\.issueStrategyApproval/);
  assert.match(controlIpc, /paperApprovalService\.revoke/);
  // Kill switch: the audit write happens before the state assignment, in source order, inside
  // the same function -- so a thrown write can never be followed by the assignment.
  const auditFnStart = main.indexOf("function recordKillSwitchAudit");
  const auditFnEnd = main.indexOf("\n}", auditFnStart);
  const auditFnBody = main.slice(auditFnStart, auditFnEnd);
  assert.match(auditFnBody, /appendOperationsAudit\(auditRecord\)/);
  assert.doesNotMatch(auditFnBody, /persistedKillSwitchActive\s*=/);
  assert.match(safetyIpc, /recordKillSwitchAudit\("KILL_SWITCH_RELEASED"/);
  assert.match(safetyIpc, /recordKillSwitchAudit\("KILL_SWITCH_ACTIVATED"/);
  const releaseStart = safetyIpc.indexOf('ipcMain.handle("safety:kill-switch-release"');
  const releaseEnd = safetyIpc.indexOf("});", releaseStart);
  const releaseBody = safetyIpc.slice(releaseStart, releaseEnd);
  assert.ok(releaseBody.indexOf("recordKillSwitchAudit(") < releaseBody.indexOf("persistedKillSwitchActive = false"));
  // approvalId must never be a literal string constant assigned directly in an IPC handler --
  // it must come from a PaperApprovalService call's return value.
  assert.doesNotMatch(main, /approvalId:\s*"[^"]+"/);
  assert.doesNotMatch(paperIpc, /approvalId:\s*"[^"]+"/);
  assert.doesNotMatch(controlIpc, /approvalId:\s*"[^"]+"/);
  assert.doesNotMatch(safetyIpc, /approvalId:\s*"[^"]+"/);
  // PaperApprovalService is the only place in the desktop app allowed to call saveApproval.
  assert.match(approvalService, /gate\.saveApproval/);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
  for (const file of walk(root)) {
    if (path.basename(file) === "paperApprovalService.ts" || !file.endsWith(".ts")) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.saveApproval\(/, `${path.relative(root, file)} must not call saveApproval directly; only PaperApprovalService may`);
  }
});

test("Desktop SQLite migration persists canonical approval, day state, order state, and idempotency across restart, and revocation survives restart", () => {
  const approval = { approvalId: "approval-manual-1", approvedBy: "owner", approvedAtMs: NOW - 1_000, expiresAtMs: NOW + 60_000, mode: "PAPER", symbol: "KRW-BTC", strategyId: "MANUAL", policyFingerprint: "policy-1" };
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "nusa-risk-runtime-"));
  const file = path.join(root, "paper.sqlite");
  try {
    const first = new DesktopPersistenceStore(file);
    const repository = first.riskSafetyRepository();
    repository.saveApproval(approval);
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
    restored.revokeApproval("approval-manual-1", "test");
    restarted.close();
    const third = new DesktopPersistenceStore(file);
    assert.equal(third.riskSafetyRepository().loadApproval("approval-manual-1"), undefined);
    third.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
