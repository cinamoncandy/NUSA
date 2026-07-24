const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionAction,
  DecisionState,
  DecisionExecutionMode,
  createDecisionAuditEnvelope,
  evaluateDecision,
  issueDecisionExecutionAuthorization,
  verifyDecisionExecutionAuthorization
} = require("../dist/packages/contracts/src/index.js");

const policy = {
  policyId: "committee-v1",
  policyVersion: "1.0.0",
  eligibleMembers: 3,
  minimumQuorum: 3,
  minimumAgreementRatio: 0.66,
  maximumFamilyVotes: 1
};

const ballot = (memberId, family, action) => ({
  memberId,
  memberVersion: "1.0.0",
  family,
  action,
  support: 0.8,
  evidenceRefs: [`evidence:${memberId}`],
  evaluatedAt: "2026-07-16T00:00:00.000Z"
});

function envelopeFor(action = DecisionAction.LONG) {
  const result = evaluateDecision(policy, [
    ballot("trend", "trend", action),
    ballot("regime", "regime", action),
    ballot("micro", "microstructure", action)
  ], [{ gateId: "risk", passed: true }, { gateId: "persistence", passed: true }]);
  assert.equal(result.state, DecisionState.APPROVED_PAPER_ACTION);
  return createDecisionAuditEnvelope({
    decisionId: "decision-1",
    market: "KRW-BTC",
    snapshotId: "snapshot-1",
    snapshotChecksum: "a".repeat(64),
    createdAt: "2026-07-16T00:00:00.000Z",
    codeVersion: "commit-sha",
    result
  });
}

test("approved audited decisions issue Paper-only execution authorization", () => {
  const envelope = envelopeFor();
  const authorization = issueDecisionExecutionAuthorization({
    authorizationId: "authorization-1",
    envelope,
    issuedAt: "2026-07-16T00:00:01.000Z",
    expiresAt: "2026-07-16T00:05:01.000Z",
    nonce: "nonce-1"
  });
  assert.equal(authorization.mode, DecisionExecutionMode.PAPER);
  assert.equal(authorization.decisionId, envelope.record.decisionId);
  assert.equal(authorization.auditChecksum, envelope.envelopeChecksum);
  assert.equal(authorization.action, DecisionAction.LONG);
  assert.match(authorization.checksum, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(authorization));
  assert.equal(verifyDecisionExecutionAuthorization(authorization, envelope, "2026-07-16T00:02:00.000Z"), true);
});

test("expired, premature, altered, or mismatched authorizations fail closed", () => {
  const envelope = envelopeFor();
  const authorization = issueDecisionExecutionAuthorization({
    authorizationId: "authorization-1",
    envelope,
    issuedAt: "2026-07-16T00:00:01.000Z",
    expiresAt: "2026-07-16T00:05:01.000Z",
    nonce: "nonce-1"
  });
  assert.equal(verifyDecisionExecutionAuthorization(authorization, envelope, "2026-07-15T23:59:59.000Z"), false);
  assert.equal(verifyDecisionExecutionAuthorization(authorization, envelope, "2026-07-16T00:05:01.000Z"), false);
  assert.equal(verifyDecisionExecutionAuthorization({ ...authorization, market: "BTCUSDT" }, envelope, "2026-07-16T00:02:00.000Z"), false);
  assert.equal(verifyDecisionExecutionAuthorization(authorization, envelopeFor(DecisionAction.SHORT), "2026-07-16T00:02:00.000Z"), false);
});

test("non-approved and non-executable outcomes cannot issue authorization", () => {
  const result = evaluateDecision(policy, [
    ballot("trend", "trend", DecisionAction.HOLD),
    ballot("regime", "regime", DecisionAction.HOLD),
    ballot("micro", "microstructure", DecisionAction.HOLD)
  ]);
  const envelope = createDecisionAuditEnvelope({
    decisionId: "decision-hold",
    market: "KRW-BTC",
    snapshotId: "snapshot-hold",
    snapshotChecksum: "b".repeat(64),
    createdAt: "2026-07-16T00:00:00.000Z",
    codeVersion: "commit-sha",
    result
  });
  assert.throws(() => issueDecisionExecutionAuthorization({
    authorizationId: "authorization-hold",
    envelope,
    issuedAt: "2026-07-16T00:00:01.000Z",
    expiresAt: "2026-07-16T00:05:01.000Z",
    nonce: "nonce-hold"
  }), /not approved/);
});

test("authorization expiry must be strictly after issuance", () => {
  const envelope = envelopeFor();
  assert.throws(() => issueDecisionExecutionAuthorization({
    authorizationId: "authorization-1",
    envelope,
    issuedAt: "2026-07-16T00:05:01.000Z",
    expiresAt: "2026-07-16T00:05:01.000Z",
    nonce: "nonce-1"
  }), /after issuedAt/);
});
