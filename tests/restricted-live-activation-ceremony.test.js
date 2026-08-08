"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESTRICTED_LIVE_ACTIVATION_CEREMONY_DESCRIPTOR,
  computeCeremonyScopeFingerprint,
  evaluateRestrictedLiveActivationCeremony
} = require("../dist/apps/execution/src/index.js");
const { validateRestrictedLiveActivationCeremony } = require("../scripts/validate-restricted-live-activation-ceremony.js");

const PREFLIGHT = "a".repeat(64);
const REV = "b".repeat(40);
const CFG = "c".repeat(64);
const scope = () => ({
  deploymentBundleId: "bundle-restricted-1",
  rollbackBundleId: "bundle-rollback-1",
  capabilityContract: "restricted-live-v1",
  strategyIdentity: "strategy-bounded-1",
  symbols: ["KRW-BTC"],
  maxOrderNotional: 10000,
  maxPortfolioExposure: 50000,
  startsAt: "2026-08-08T01:00:00.000Z",
  expiresAt: "2026-08-08T02:00:00.000Z",
  cooldownSeconds: 300
});

function approval(id, digest, overrides = {}) {
  const currentScope = scope();
  return {
    principalId: id,
    principalKind: "HUMAN",
    ceremonyId: "ceremony-1",
    preflightFingerprint: PREFLIGHT,
    scopeFingerprint: computeCeremonyScopeFingerprint(currentScope),
    approvedAt: id.endsWith("1") ? "2026-08-08T01:10:00.000Z" : "2026-08-08T01:12:00.000Z",
    signatureVerification: "PASS",
    attestationDigest: digest,
    ...overrides
  };
}

function valid(overrides = {}) {
  return {
    ceremonyId: "ceremony-1",
    evaluatedAt: "2026-08-08T01:15:00.000Z",
    requester: { principalId: "requester-human", principalKind: "HUMAN" },
    approvers: [approval("approver-1", "d".repeat(64)), approval("approver-2", "e".repeat(64))],
    preflightVerdict: "READY_FOR_HUMAN_REVIEW",
    preflightFingerprint: PREFLIGHT,
    codeRevision: REV,
    configurationHash: CFG,
    scope: scope(),
    reason: "bounded restricted live manual review",
    auditReceiptId: "audit-receipt-1",
    antiReplayState: "UNUSED",
    executionTransportConnected: false,
    executionCredentialUseEnabled: false,
    realMoneyExecutionAllowed: false,
    automaticActivationAllowed: false,
    killSwitch: "INACTIVE",
    mutationCounters: { brokerCalls: 0, orders: 0, fills: 0, cash: 0, positions: 0 },
    ...overrides
  };
}

test("exact two-human synthetic ceremony is complete for separate manual review only", () => {
  const result = evaluateRestrictedLiveActivationCeremony(valid());
  assert.equal(result.verdict, "COMPLETE_FOR_SEPARATE_MANUAL_ACTIVATION_REVIEW");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.activationCredentialIssued, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.actualActivationPerformed, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("approval ordering normalizes while attestation changes alter ceremony fingerprint", () => {
  const first = valid();
  const reordered = { ...first, approvers: [first.approvers[1], first.approvers[0]] };
  const left = evaluateRestrictedLiveActivationCeremony(first);
  const right = evaluateRestrictedLiveActivationCeremony(reordered);
  assert.equal(left.ceremonyFingerprint, right.ceremonyFingerprint);
  const changed = valid({ approvers: [approval("approver-1", "f".repeat(64)), approval("approver-2", "e".repeat(64))] });
  assert.notEqual(evaluateRestrictedLiveActivationCeremony(changed).ceremonyFingerprint, left.ceremonyFingerprint);
});

test("duplicate, non-human, requester-self, mismatch, expiry, used id, and unsafe runtime block", () => {
  const duplicate = valid({ approvers: [approval("approver-1", "d".repeat(64)), approval("approver-1", "e".repeat(64))] });
  assert.equal(evaluateRestrictedLiveActivationCeremony(duplicate).verdict, "SAFE_BLOCK");
  const nonHuman = valid({ approvers: [approval("approver-1", "d".repeat(64), { principalKind: "AI" }), approval("approver-2", "e".repeat(64))] });
  assert.equal(evaluateRestrictedLiveActivationCeremony(nonHuman).verdict, "SAFE_BLOCK");
  const requesterSelf = valid({ approvers: [approval("requester-human", "d".repeat(64)), approval("approver-2", "e".repeat(64))] });
  assert.equal(evaluateRestrictedLiveActivationCeremony(requesterSelf).verdict, "SAFE_BLOCK");
  const mismatch = valid({ approvers: [approval("approver-1", "d".repeat(64), { preflightFingerprint: "0".repeat(64) }), approval("approver-2", "e".repeat(64))] });
  assert.equal(evaluateRestrictedLiveActivationCeremony(mismatch).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ evaluatedAt: "2026-08-08T02:01:00.000Z" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ antiReplayState: "USED" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ executionTransportConnected: true })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ executionCredentialUseEnabled: true })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ killSwitch: "ACTIVE" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ mutationCounters: { brokerCalls: 0, orders: 1, fills: 0, cash: 0, positions: 0 } })).verdict, "SAFE_BLOCK");
});

test("unknown external verification, anti-replay, preflight, or kill switch remains unknown", () => {
  const unknownSignature = valid({ approvers: [approval("approver-1", "d".repeat(64), { signatureVerification: "UNKNOWN" }), approval("approver-2", "e".repeat(64))] });
  assert.equal(evaluateRestrictedLiveActivationCeremony(unknownSignature).verdict, "UNKNOWN");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ antiReplayState: "UNKNOWN" })).verdict, "UNKNOWN");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ preflightVerdict: "UNKNOWN" })).verdict, "UNKNOWN");
  assert.equal(evaluateRestrictedLiveActivationCeremony(valid({ killSwitch: "UNKNOWN" })).verdict, "UNKNOWN");
});

test("scope fingerprint binds exact limits, symbols, bundle, and time window", () => {
  const base = computeCeremonyScopeFingerprint(scope());
  assert.notEqual(computeCeremonyScopeFingerprint({ ...scope(), maxOrderNotional: 10001 }), base);
  assert.notEqual(computeCeremonyScopeFingerprint({ ...scope(), symbols: ["KRW-ETH"] }), base);
  assert.notEqual(computeCeremonyScopeFingerprint({ ...scope(), rollbackBundleId: "bundle-rollback-2" }), base);
  assert.notEqual(computeCeremonyScopeFingerprint({ ...scope(), expiresAt: "2026-08-08T01:59:00.000Z" }), base);
});

test("source guard proves ceremony validation cannot activate LIVE", () => {
  const source = validateRestrictedLiveActivationCeremony();
  assert.equal(source.ok, true, source.failures.join(","));
  assert.equal(RESTRICTED_LIVE_ACTIVATION_CEREMONY_DESCRIPTOR.activationCredentialIssued, false);
  assert.equal(RESTRICTED_LIVE_ACTIVATION_CEREMONY_DESCRIPTOR.executionAuthority, false);
  assert.equal(RESTRICTED_LIVE_ACTIVATION_CEREMONY_DESCRIPTOR.authorizesLive, false);
  assert.equal(RESTRICTED_LIVE_ACTIVATION_CEREMONY_DESCRIPTOR.actualActivationPerformed, false);
  assert.equal(RESTRICTED_LIVE_ACTIVATION_CEREMONY_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
