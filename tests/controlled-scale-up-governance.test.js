"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR,
  computeScaleEnvelopeFingerprint,
  evaluateControlledScaleUpGovernance,
} = require("../dist/apps/execution/src/index.js");
const { validateControlledScaleUpGovernance } = require("../scripts/validate-controlled-scale-up-governance.js");

const REV = "1".repeat(40);
const HASH = (char) => char.repeat(64);
function currentEnvelope() {
  return { symbols: ["KRW-BTC"], maxOrderNotionalBps: 10, maxGrossExposureBps: 50, maxDailyLossBps: 10, maxOpenOrders: 1, maxPositionCount: 1, maxSessionOrders: 5, maxSessionDurationSeconds: 3600 };
}
function proposedEnvelope() {
  return { symbols: ["KRW-BTC"], maxOrderNotionalBps: 12, maxGrossExposureBps: 60, maxDailyLossBps: 10, maxOpenOrders: 1, maxPositionCount: 1, maxSessionOrders: 5, maxSessionDurationSeconds: 3600 };
}
function valid(overrides = {}) {
  const current = currentEnvelope();
  const proposed = proposedEnvelope();
  const proposedFingerprint = computeScaleEnvelopeFingerprint(proposed);
  const prior = HASH("2");
  const input = {
    policyChangeId: "scale-change-1",
    evaluatedAt: "2026-08-08T03:30:00.000Z",
    reviewStartsAt: "2026-08-08T03:00:00.000Z",
    reviewExpiresAt: "2026-08-08T04:00:00.000Z",
    lastValidatedSessionEndedAt: "2026-08-08T02:00:00.000Z",
    cooldownSeconds: 1800,
    requester: { principalId: "human-requester", principalKind: "HUMAN" },
    approvers: [
      { principalId: "human-approver-a", principalKind: "HUMAN", policyChangeId: "scale-change-1", priorPostLiveValidationFingerprint: prior, proposedEnvelopeFingerprint: proposedFingerprint, approvedAt: "2026-08-08T03:10:00.000Z", signatureVerification: "PASS", attestationDigest: HASH("a") },
      { principalId: "human-approver-b", principalKind: "HUMAN", policyChangeId: "scale-change-1", priorPostLiveValidationFingerprint: prior, proposedEnvelopeFingerprint: proposedFingerprint, approvedAt: "2026-08-08T03:15:00.000Z", signatureVerification: "PASS", attestationDigest: HASH("b") },
    ],
    codeRevision: REV,
    configurationHash: HASH("3"),
    priorPostLiveVerdict: "READY_FOR_HUMAN_REVIEW",
    priorPostLiveValidationFingerprint: prior,
    currentEnvelope: current,
    currentEnvelopeFingerprint: computeScaleEnvelopeFingerprint(current),
    proposedEnvelope: proposed,
    reason: "controlled risk increase review",
    auditReceiptId: "audit-scale-1",
    antiReplayState: "UNUSED",
    safetyState: "SAFE",
    killSwitchReady: "PASS",
    rollback: "PASS",
    reconciliation: "MATCH",
    auditChain: "PASS",
    incidentState: "CLEAR",
  };
  return { ...input, ...overrides };
}

test("exact synthetic two-human scale record is complete for separate manual review only", () => {
  const result = evaluateControlledScaleUpGovernance(valid());
  assert.equal(result.verdict, "COMPLETE_FOR_SEPARATE_MANUAL_SCALE_CHANGE_REVIEW");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
  assert.match(result.reviewFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.scaleUpAuthority, false);
  assert.equal(result.activationAuthority, false);
  assert.equal(result.orderAuthorization, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("duplicate non-human self or proposal-mismatched approvals block", () => {
  const duplicate = valid();
  duplicate.approvers = [duplicate.approvers[0], { ...duplicate.approvers[0] }];
  assert.equal(evaluateControlledScaleUpGovernance(duplicate).verdict, "SAFE_BLOCK");

  const nonHuman = valid();
  nonHuman.approvers = [{ ...nonHuman.approvers[0], principalKind: "AI" }, nonHuman.approvers[1]];
  assert.equal(evaluateControlledScaleUpGovernance(nonHuman).verdict, "SAFE_BLOCK");

  const self = valid();
  self.approvers = [{ ...self.approvers[0], principalId: "human-requester" }, self.approvers[1]];
  assert.equal(evaluateControlledScaleUpGovernance(self).verdict, "SAFE_BLOCK");

  const mismatch = valid();
  mismatch.approvers = [{ ...mismatch.approvers[0], proposedEnvelopeFingerprint: HASH("9") }, mismatch.approvers[1]];
  assert.equal(evaluateControlledScaleUpGovernance(mismatch).verdict, "SAFE_BLOCK");
});

test("unsafe lifecycle evidence and replay block", () => {
  assert.equal(evaluateControlledScaleUpGovernance(valid({ antiReplayState: "USED" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ safetyState: "UNSAFE" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ rollback: "FAIL" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ reconciliation: "DIFF" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ incidentState: "OPEN" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ evaluatedAt: "2026-08-08T02:20:00.000Z" })).verdict, "SAFE_BLOCK");
});

test("proposal must be explicit monotonic risk increase and current envelope must match fingerprint", () => {
  const lower = valid({ proposedEnvelope: { ...currentEnvelope(), maxOrderNotionalBps: 9 } });
  assert.equal(evaluateControlledScaleUpGovernance(lower).verdict, "SAFE_BLOCK");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ currentEnvelopeFingerprint: HASH("f") })).verdict, "SAFE_BLOCK");
});

test("unknown signature anti-replay or safety evidence remains UNKNOWN", () => {
  const signature = valid();
  signature.approvers = [{ ...signature.approvers[0], signatureVerification: "UNKNOWN" }, signature.approvers[1]];
  assert.equal(evaluateControlledScaleUpGovernance(signature).verdict, "UNKNOWN");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ antiReplayState: "UNKNOWN" })).verdict, "UNKNOWN");
  assert.equal(evaluateControlledScaleUpGovernance(valid({ safetyState: "UNKNOWN" })).verdict, "UNKNOWN");
});

test("identical normalized governance evidence yields identical review fingerprint", () => {
  const first = evaluateControlledScaleUpGovernance(valid());
  const second = evaluateControlledScaleUpGovernance(valid());
  assert.equal(first.reviewFingerprint, second.reviewFingerprint);
  assert.notEqual(evaluateControlledScaleUpGovernance(valid({ reason: "different approved reason" })).reviewFingerprint, first.reviewFingerprint);
});

test("source guard proves governance cannot apply scale or trade", () => {
  const result = validateControlledScaleUpGovernance();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.actualHumanApprovalInCi, false);
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.automaticScaleUpAllowed, false);
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.scaleUpAuthority, false);
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.activationAuthority, false);
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.orderAuthorization, false);
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.executionAuthority, false);
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.authorizesLive, false);
  assert.equal(CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
