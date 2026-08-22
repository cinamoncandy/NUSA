const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperApprovalService, MANUAL_APPROVAL_TTL_MS, STRATEGY_APPROVAL_TTL_MS } = require("../dist/apps/desktop/src/paper/paperApprovalService.js");
const { CanonicalRiskSafetyGate, InMemoryRiskSafetyPersistence } = require("../dist/apps/execution/src/risk-safety-integration.js");

const NOW = 1_750_000_000_000;

function service() {
  const persistence = new InMemoryRiskSafetyPersistence();
  return { service: new PaperApprovalService(new CanonicalRiskSafetyGate(persistence)), persistence };
}

test("issueManualApproval mints a MANUAL-scoped, side- and commandId-bound approval with a 60s TTL, and persists it", () => {
  const { service: svc, persistence } = service();
  const approval = svc.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "cmd-1", policyFingerprint: "policy-1", nowMs: NOW });
  assert.equal(approval.mode, "PAPER");
  assert.equal(approval.symbol, "KRW-BTC");
  assert.equal(approval.strategyId, "MANUAL");
  assert.equal(approval.side, "BUY");
  assert.equal(approval.commandId, "cmd-1");
  assert.equal(approval.approvedBy, "LOCAL_OPERATOR");
  assert.equal(approval.expiresAtMs - approval.approvedAtMs, MANUAL_APPROVAL_TTL_MS);
  assert.equal(approval.expiresAtMs - NOW, 60_000);
  assert.ok(persistence.loadApproval(approval.approvalId));
});

test("issueManualApproval mints a distinct approvalId on every call, never reused across orders", () => {
  const { service: svc } = service();
  const first = svc.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "cmd-1", policyFingerprint: "policy-1", nowMs: NOW });
  const second = svc.issueManualApproval({ symbol: "KRW-BTC", side: "BUY", commandId: "cmd-2", policyFingerprint: "policy-1", nowMs: NOW });
  assert.notEqual(first.approvalId, second.approvalId);
});

test("issueStrategyApproval mints a STRATEGY-scoped approval with a 1-hour TTL and no side/commandId binding", () => {
  const { service: svc, persistence } = service();
  const approval = svc.issueStrategyApproval({ symbol: "KRW-BTC", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW });
  assert.equal(approval.strategyId, "sma-crossover");
  assert.equal(approval.side, undefined);
  assert.equal(approval.commandId, undefined);
  assert.equal(approval.expiresAtMs - approval.approvedAtMs, STRATEGY_APPROVAL_TTL_MS);
  assert.equal(approval.expiresAtMs - NOW, 3_600_000);
  assert.ok(persistence.loadApproval(approval.approvalId));
});

test("revoke makes an issued approval immediately unusable", () => {
  const { service: svc, persistence } = service();
  const approval = svc.issueStrategyApproval({ symbol: "KRW-BTC", strategyId: "sma-crossover", policyFingerprint: "policy-1", nowMs: NOW });
  assert.ok(persistence.loadApproval(approval.approvalId));
  svc.revoke(approval.approvalId, "STRATEGY_STOPPED");
  assert.equal(persistence.loadApproval(approval.approvalId), undefined);
});

test("issuance fails closed when the underlying gate rejects the approval (e.g. malformed input)", () => {
  const { persistence } = service();
  const throwing = { saveApproval() { throw new Error("policy fingerprint required"); }, revokeApproval() {} };
  const svc = new PaperApprovalService(throwing);
  assert.throws(() => svc.issueManualApproval({ symbol: "", side: "BUY", commandId: "cmd-1", policyFingerprint: "policy-1", nowMs: NOW }), /policy fingerprint required/);
});
