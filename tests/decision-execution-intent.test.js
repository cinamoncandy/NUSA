const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionAction,
  evaluateDecision
} = require("../dist/packages/contracts/src/decision.js");
const {
  createDecisionAuditEnvelope
} = require("../dist/packages/contracts/src/decisionAudit.js");
const {
  issueDecisionExecutionAuthorization
} = require("../dist/packages/contracts/src/decisionAuthorization.js");
const {
  createDecisionExecutionIntent,
  verifyDecisionExecutionIntent,
  assertUniqueDecisionExecutionIntent
} = require("../dist/packages/contracts/src/decisionExecutionIntent.js");

function approvedEnvelope() {
  const result = evaluateDecision({
    policyId: "committee-v1",
    policyVersion: "1.0.0",
    eligibleMembers: 3,
    minimumQuorum: 3,
    minimumAgreementRatio: 0.66,
    maximumFamilyVotes: 1
  }, [
    { memberId: "trend", memberVersion: "1", family: "trend", action: DecisionAction.LONG, support: 0.8, evidenceRefs: ["e1"], evaluatedAt: "2026-07-16T00:00:00.000Z" },
    { memberId: "regime", memberVersion: "1", family: "regime", action: DecisionAction.LONG, support: 0.7, evidenceRefs: ["e2"], evaluatedAt: "2026-07-16T00:00:00.000Z" },
    { memberId: "micro", memberVersion: "1", family: "micro", action: DecisionAction.LONG, support: 0.7, evidenceRefs: ["e3"], evaluatedAt: "2026-07-16T00:00:00.000Z" }
  ], [{ gateId: "risk", passed: true }]);

  return createDecisionAuditEnvelope({
    decisionId: "decision-1",
    market: "KRW-BTC",
    snapshotId: "snapshot-1",
    snapshotChecksum: "snapshot-checksum",
    createdAt: "2026-07-16T00:00:00.000Z",
    codeVersion: "abc123",
    result
  });
}

function authorization(envelope) {
  return issueDecisionExecutionAuthorization({
    authorizationId: "authorization-1",
    envelope,
    issuedAt: "2026-07-16T00:01:00.000Z",
    expiresAt: "2026-07-16T00:06:00.000Z",
    nonce: "nonce-1"
  });
}

test("a valid Paper authorization creates a frozen execution intent", () => {
  const envelope = approvedEnvelope();
  const auth = authorization(envelope);
  const intent = createDecisionExecutionIntent({
    intentId: "intent-1",
    authorization: auth,
    envelope,
    quantity: "0.001",
    createdAt: "2026-07-16T00:02:00.000Z"
  });
  assert.equal(intent.mode, "PAPER");
  assert.equal(intent.decisionId, "decision-1");
  assert.equal(intent.quantity, "0.001");
  assert.equal(intent.checksum.length, 64);
  assert.ok(Object.isFrozen(intent));
  assert.equal(verifyDecisionExecutionIntent(intent, auth, envelope, "2026-07-16T00:03:00.000Z"), true);
});

test("expired authorization and invalid quantities cannot create an intent", () => {
  const envelope = approvedEnvelope();
  const auth = authorization(envelope);
  assert.throws(() => createDecisionExecutionIntent({
    intentId: "late",
    authorization: auth,
    envelope,
    quantity: "0.001",
    createdAt: "2026-07-16T00:07:00.000Z"
  }), /invalid or expired/);
  for (const quantity of ["0", "-1", "NaN", "", "1e-3"]) {
    assert.throws(() => createDecisionExecutionIntent({
      intentId: `bad-${quantity}`,
      authorization: auth,
      envelope,
      quantity,
      createdAt: "2026-07-16T00:02:00.000Z"
    }));
  }
});

test("tampering and cross-authorization reuse fail verification", () => {
  const envelope = approvedEnvelope();
  const auth = authorization(envelope);
  const intent = createDecisionExecutionIntent({
    intentId: "intent-1",
    authorization: auth,
    envelope,
    quantity: "0.001",
    createdAt: "2026-07-16T00:02:00.000Z"
  });
  assert.equal(verifyDecisionExecutionIntent({ ...intent, quantity: "0.002" }, auth, envelope, "2026-07-16T00:03:00.000Z"), false);
  assert.equal(verifyDecisionExecutionIntent({ ...intent, market: "USDT-BTC" }, auth, envelope, "2026-07-16T00:03:00.000Z"), false);
});

test("one authorization cannot produce multiple accepted intents", () => {
  const envelope = approvedEnvelope();
  const auth = authorization(envelope);
  const first = createDecisionExecutionIntent({ intentId: "intent-1", authorization: auth, envelope, quantity: "0.001", createdAt: "2026-07-16T00:02:00.000Z" });
  const second = createDecisionExecutionIntent({ intentId: "intent-2", authorization: auth, envelope, quantity: "0.002", createdAt: "2026-07-16T00:02:30.000Z" });
  assert.throws(() => assertUniqueDecisionExecutionIntent([first], second), /already produced/);
  assert.throws(() => assertUniqueDecisionExecutionIntent([first], { ...second, intentId: "intent-1", idempotencyKey: "other" }), /duplicate execution intent id/);
});
