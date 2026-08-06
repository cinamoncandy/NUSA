const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { SqliteDatabase, SqliteRiskSafetyPersistence } = require("../dist/packages/storage/src/index.js");
const {
  CanonicalRiskSafetyGate,
  InMemoryRiskSafetyPersistence,
  tradingDayKey,
  countOpenOrders
} = require("../dist/apps/execution/src/risk-safety-integration.js");

const market = "KRW-BTC";
const policyFingerprint = "policy-v1";
const firstDay = Date.UTC(2026, 0, 1, 14, 59, 0);
const nextDay = Date.UTC(2026, 0, 1, 15, 0, 0);

function approval(overrides = {}) {
  return {
    approvalId: "approval-1",
    mode: "PAPER",
    symbol: market,
    strategyId: "strategy-1",
    policyFingerprint,
    expiresAtMs: nextDay + 60_000,
    approvedBy: "operator",
    approvedAtMs: firstDay - 1_000,
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    accountId: "paper-1",
    requestId: "request-1",
    boundary: "MANUAL",
    mode: "PAPER",
    symbol: market,
    strategyId: "strategy-1",
    policyFingerprint,
    approvalId: "approval-1",
    nowMs: firstDay,
    currentEquity: 1_000,
    marketDataFresh: true,
    marketHealthy: true,
    killSwitchActive: false,
    liveMutationAllowed: false,
    recoveryReady: true,
    persistenceHealthy: true,
    maxDailyLoss: 100,
    maxOpenOrders: 10,
    idempotency: { accountId: "paper-1", commandId: "command-1", signalId: "signal-1", clientOrderId: "client-1", payloadFingerprint: "input", createdAtMs: firstDay },
    ...overrides
  };
}

test("approval creation validates scope and expiry", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval());
  assert.ok(persistence.loadApproval("approval-1"));
  assert.throws(() => gate.saveApproval(approval({ expiresAtMs: firstDay - 1_000 })), /approval expiry/);
});

test("manual and strategy orders require a matching unexpired approval before broker", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  let brokerCalls = 0;
  const broker = { submit() { brokerCalls += 1; } };
  const missing = gate.evaluateAndSubmit(request({ approvalId: undefined }), broker);
  assert.equal(missing.status, "BLOCKED");
  assert.ok(missing.reasonCodes.includes("APPROVAL_MISSING"));
  assert.equal(brokerCalls, 0);
  gate.saveApproval(approval());
  const strategy = gate.evaluateAndSubmit(request({ boundary: "STRATEGY", requestId: "strategy-request", idempotency: { ...request().idempotency, commandId: "command-2", signalId: "signal-2", clientOrderId: "client-2" } }), broker);
  assert.equal(strategy.status, "APPROVED");
  assert.equal(brokerCalls, 1);
});

test("expired, scope-mismatched and fingerprint-mismatched approval fails closed", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval());
  assert.equal(gate.evaluate(request({ nowMs: nextDay + 60_001 })).status, "BLOCKED");
  assert.ok(gate.evaluate(request({ strategyId: "other", idempotency: { ...request().idempotency, commandId: "c2", signalId: "s2", clientOrderId: "o2" } })).reasonCodes.includes("APPROVAL_SCOPE_MISMATCH"));
  assert.ok(gate.evaluate(request({ policyFingerprint: "policy-v2", idempotency: { ...request().idempotency, commandId: "c3", signalId: "s3", clientOrderId: "o3" } })).reasonCodes.includes("RISK_POLICY_FINGERPRINT_MISMATCH"));
});

test("SHADOW evaluates through the canonical gate but never calls the broker", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  let calls = 0;
  const decision = gate.evaluateAndSubmit(request({ boundary: "SHADOW", mode: "PAPER", approvalId: undefined }), { submit() { calls += 1; } });
  assert.equal(decision.status, "BLOCKED");
  assert.ok(decision.reasonCodes.includes("SHADOW_EVALUATION_ONLY"));
  assert.equal(calls, 0);
});

test("KST trading day initializes, resets at 00:00, and preserves same-day baseline", () => {
  assert.equal(tradingDayKey(firstDay), "2026-01-01");
  assert.equal(tradingDayKey(nextDay), "2026-01-02");
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval({ expiresAtMs: nextDay + 1_000_000 }));
  const first = gate.evaluate(request({ currentEquity: 1_000 }));
  assert.equal(first.status, "APPROVED");
  assert.equal(persistence.loadDailyLoss("paper-1").dayStartEquity, 1_000);
  const sameDay = gate.evaluate(request({ nowMs: firstDay + 1_000, currentEquity: 950, idempotency: { ...request().idempotency, commandId: "c4", signalId: "s4", clientOrderId: "o4" } }));
  assert.equal(sameDay.status, "APPROVED");
  assert.equal(persistence.loadDailyLoss("paper-1").dayStartEquity, 1_000);
  const reset = gate.evaluate(request({ nowMs: nextDay, currentEquity: 950, idempotency: { ...request().idempotency, commandId: "c5", signalId: "s5", clientOrderId: "o5" } }));
  assert.equal(reset.status, "APPROVED");
  assert.equal(persistence.loadDailyLoss("paper-1").tradingDay, "2026-01-02");
  assert.equal(persistence.loadDailyLoss("paper-1").dayStartEquity, 950);
});

test("daily loss blocks once current equity breaches the persisted baseline", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval());
  gate.evaluate(request({ currentEquity: 1_000 }));
  const decision = gate.evaluate(request({ currentEquity: 899, idempotency: { ...request().idempotency, commandId: "loss-c", signalId: "loss-s", clientOrderId: "loss-o" } }));
  assert.equal(decision.status, "REJECTED");
  assert.ok(decision.reasonCodes.includes("DAILY_LOSS_LIMIT"));
});

test("only OPEN and PENDING orders count; filled history does not", () => {
  assert.equal(countOpenOrders([{ accountId: "a", orderId: "1", status: "OPEN", updatedAtMs: 1 }, { accountId: "a", orderId: "2", status: "PENDING", updatedAtMs: 1 }, { accountId: "a", orderId: "3", status: "FILLED", updatedAtMs: 1 }, { accountId: "a", orderId: "4", status: "CANCELLED", updatedAtMs: 1 }, { accountId: "a", orderId: "5", status: "REJECTED", updatedAtMs: 1 }]), 2);
  const persistence = new InMemoryRiskSafetyPersistence();
  persistence.saveOrder({ accountId: "paper-1", orderId: "filled", status: "FILLED", updatedAtMs: 1 });
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval());
  assert.equal(gate.evaluate(request({ maxOpenOrders: 1 })).status, "APPROVED");
});

test("command, signal, and client order ids are idempotent across restart", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval());
  assert.equal(gate.evaluate(request()).status, "APPROVED");
  const duplicate = gate.evaluate(request());
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.reasonCodes.includes("DUPLICATE_COMMAND"));
  assert.throws(() => persistence.claimIdempotency({ ...request().idempotency, payloadFingerprint: "different" }), /IDEMPOTENCY_CONFLICT/);
});

test("canonical decision and dashboard projection have identical status and reason codes", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  const decision = gate.evaluate(request({ killSwitchActive: true }));
  const dashboard = gate.projectDashboard(decision);
  assert.equal(dashboard.status, decision.status);
  assert.deepEqual([...dashboard.reasonCodes], [...decision.reasonCodes]);
  assert.deepEqual(gate.projectDashboard({ productionMutationAllowed: true, reasonCodes: [] }), { status: "BLOCKED", reasonCodes: ["PROJECTION_UNHEALTHY"] });
});

test("kill switch, LIVE mode, stale market, and recovery uncertainty fail closed", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval({ expiresAtMs: nextDay + 1_000_000 }));
  for (const [key, expected] of [["killSwitchActive", "KILL_SWITCH_ACTIVE"], ["mode", "LIVE_CAPABILITY_DETECTED"], ["marketDataFresh", "MARKET_DATA_STALE"], ["recoveryReady", "RECOVERY_PENDING"]]) {
    const value = key === "mode" ? "LIVE" : key === "killSwitchActive" ? true : false;
    const decision = gate.evaluate(request({ [key]: value, idempotency: { ...request().idempotency, commandId: `${key}-c`, signalId: `${key}-s`, clientOrderId: `${key}-o` } }));
    assert.equal(decision.status, "BLOCKED");
    assert.ok(decision.reasonCodes.includes(expected));
  }
});

test("persistence failure produces UNKNOWN and never submits", () => {
  const broken = { saveApproval() {}, loadApproval() { throw new Error("database unavailable"); }, loadDailyLoss() { throw new Error("database unavailable"); }, saveDailyLoss() {}, getIdempotency() { return undefined; }, claimIdempotency() {}, saveOrder() {}, listOrders() { return []; } };
  const gate = new CanonicalRiskSafetyGate(broken);
  let brokerCalls = 0;
  const decision = gate.evaluateAndSubmit(request({ approvalId: undefined }), { submit() { brokerCalls += 1; } });
  assert.equal(decision.status, "UNKNOWN");
  assert.equal(brokerCalls, 0);
  assert.ok(decision.reasonCodes.includes("PERSISTENCE_UNHEALTHY"));
});

test("all non-shadow boundaries use the same canonical gate and broker boundary", () => {
  const persistence = new InMemoryRiskSafetyPersistence();
  const gate = new CanonicalRiskSafetyGate(persistence);
  gate.saveApproval(approval({ approvalId: "approval-boundary" }));
  const decisions = ["MANUAL", "STRATEGY", "RECONNECT_REPLAY", "CANARY"].map((boundary, index) => gate.evaluate(request({ boundary, approvalId: "approval-boundary", idempotency: { ...request().idempotency, commandId: `boundary-c-${index}`, signalId: `boundary-s-${index}`, clientOrderId: `boundary-o-${index}` } })));
  assert.ok(decisions.every((decision) => decision.status === "APPROVED"));
  assert.equal(gate.evaluate(request({ boundary: "SHADOW", approvalId: undefined, idempotency: { ...request().idempotency, commandId: "boundary-shadow-c", signalId: "boundary-shadow-s", clientOrderId: "boundary-shadow-o" } })).status, "BLOCKED");
});

test("SQLite persistence restores approvals, daily loss, orders, and idempotency", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-risk-safety-")), "risk.db");
  const firstDb = new SqliteDatabase(filename);
  const firstPersistence = new SqliteRiskSafetyPersistence(firstDb);
  const firstGate = new CanonicalRiskSafetyGate(firstPersistence);
  firstGate.saveApproval(approval({ expiresAtMs: nextDay + 1_000_000 }));
  assert.equal(firstGate.evaluate(request()).status, "APPROVED");
  firstPersistence.saveOrder({ accountId: "paper-1", orderId: "filled", status: "FILLED", updatedAtMs: firstDay });
  firstDb.close();
  const secondDb = new SqliteDatabase(filename);
  const secondPersistence = new SqliteRiskSafetyPersistence(secondDb);
  const secondGate = new CanonicalRiskSafetyGate(secondPersistence);
  assert.equal(secondPersistence.loadApproval("approval-1").symbol, market);
  assert.equal(secondPersistence.loadDailyLoss("paper-1").dayStartEquity, 1_000);
  assert.equal(secondPersistence.listOrders("paper-1").length, 1);
  assert.equal(secondGate.evaluate(request()).status, "BLOCKED");
  secondDb.close();
  rmSync(filename, { force: true });
});
