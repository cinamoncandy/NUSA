"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TINY_BOUNDED_LIVE_ENVELOPE_DESCRIPTOR,
  TINY_BOUNDED_LIVE_HARD_CEILINGS,
  evaluateTinyBoundedLiveEnvelope
} = require("../dist/apps/execution/src/index.js");
const { validateTinyBoundedLiveEnvelope } = require("../scripts/validate-tiny-bounded-live-envelope.js");

const REV = "1".repeat(40);
const HASH = (char) => char.repeat(64);

function valid(overrides = {}) {
  return {
    envelopeId: "tiny-live-session-1",
    codeRevision: REV,
    configurationHash: HASH("2"),
    releaseSealFingerprint: HASH("3"),
    preflightFingerprint: HASH("4"),
    ceremonyRecordFingerprint: HASH("5"),
    capabilityContract: "restricted-live-v1",
    strategyIdentity: "strategy-identity-1",
    rollbackBundleId: "rollback-bundle-1",
    symbolAllowlist: ["KRW-BTC"],
    limits: { ...TINY_BOUNDED_LIVE_HARD_CEILINGS },
    safety: {
      killSwitchReadiness: "PASS",
      haltPathReadiness: "PASS",
      rollbackReadiness: "PASS",
      reconciliation: "MATCH",
      hardRisk: "PASS",
      marketData: "HEALTHY",
      postTradeObservation: "PASS"
    },
    singleSession: true,
    automaticRenewalAllowed: false,
    automaticScaleUpAllowed: false,
    executionTransportConnected: false,
    executionCredentialUseEnabled: false,
    realMoneyExecutionAllowed: false,
    ...overrides
  };
}

test("at-ceiling synthetic envelope validates without activation or order authority", () => {
  const result = evaluateTinyBoundedLiveEnvelope(valid());
  assert.equal(result.verdict, "BOUNDED_ENVELOPE_VALID");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.orderAuthorization, false);
  assert.equal(result.activationAuthority, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("any hard ceiling excess or extra symbol fails closed", () => {
  const excessive = valid({ limits: { ...TINY_BOUNDED_LIVE_HARD_CEILINGS, maxOrderNotionalBps: 11 } });
  assert.equal(evaluateTinyBoundedLiveEnvelope(excessive).verdict, "SAFE_BLOCK");
  assert.equal(evaluateTinyBoundedLiveEnvelope(valid({ symbolAllowlist: ["KRW-BTC", "KRW-ETH"] })).verdict, "SAFE_BLOCK");
});

test("unsafe runtime evidence and forbidden expansion fail closed", () => {
  const failedSafety = valid();
  failedSafety.safety = { ...failedSafety.safety, rollbackReadiness: "FAIL" };
  assert.equal(evaluateTinyBoundedLiveEnvelope(failedSafety).verdict, "SAFE_BLOCK");
  assert.equal(evaluateTinyBoundedLiveEnvelope(valid({ automaticScaleUpAllowed: true })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateTinyBoundedLiveEnvelope(valid({ automaticRenewalAllowed: true })).verdict, "SAFE_BLOCK");
  assert.equal(evaluateTinyBoundedLiveEnvelope(valid({ executionTransportConnected: true })).verdict, "SAFE_BLOCK");
});

test("safety-critical unknown remains UNKNOWN and fail closed", () => {
  const unknown = valid();
  unknown.safety = { ...unknown.safety, marketData: "UNKNOWN" };
  const result = evaluateTinyBoundedLiveEnvelope(unknown);
  assert.equal(result.verdict, "UNKNOWN");
  assert.equal(result.authorizesLive, false);
  assert.equal(result.orderAuthorization, false);
});

test("identical normalized envelope input yields deterministic fingerprint", () => {
  const first = evaluateTinyBoundedLiveEnvelope(valid()).envelopeFingerprint;
  const second = evaluateTinyBoundedLiveEnvelope(valid()).envelopeFingerprint;
  assert.equal(first, second);
  assert.notEqual(evaluateTinyBoundedLiveEnvelope(valid({ releaseSealFingerprint: HASH("a") })).envelopeFingerprint, first);
});

test("source guard preserves non-executable boundary", () => {
  const result = validateTinyBoundedLiveEnvelope();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(TINY_BOUNDED_LIVE_ENVELOPE_DESCRIPTOR.orderAuthorization, false);
  assert.equal(TINY_BOUNDED_LIVE_ENVELOPE_DESCRIPTOR.activationAuthority, false);
  assert.equal(TINY_BOUNDED_LIVE_ENVELOPE_DESCRIPTOR.executionAuthority, false);
  assert.equal(TINY_BOUNDED_LIVE_ENVELOPE_DESCRIPTOR.authorizesLive, false);
  assert.equal(TINY_BOUNDED_LIVE_ENVELOPE_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
