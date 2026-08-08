"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR,
  REQUIRED_TRANSITION_EVIDENCE_SLOTS,
  evaluateConstitutionalTransitionReview,
} = require("../dist/apps/execution/src/index.js");
const { validateConstitutionalHumanTransitionReview } = require("../scripts/validate-constitutional-human-transition-review.js");

const REV = "1".repeat(40);
const HASH = (char) => char.repeat(64);
const DIGESTS = "23456789";

function evidence(provenance = "SYNTHETIC_CI") {
  return REQUIRED_TRANSITION_EVIDENCE_SLOTS.map((slot, index) => ({
    slot,
    status: "PASS",
    provenance,
    evidenceRef: `evidence:${slot.toLowerCase()}`,
    evidenceDigest: HASH(DIGESTS[index]),
  }));
}

function valid(overrides = {}) {
  return {
    reviewId: "constitutional-review-1",
    codeRevision: REV,
    configurationHash: HASH("a"),
    releaseCandidateId: "release-candidate-1",
    deploymentBundleId: "deployment-bundle-1",
    rollbackBundleId: "rollback-bundle-1",
    evidence: evidence(),
    ...overrides,
  };
}

test("synthetic PASS evidence can never satisfy the real-world constitutional gate", () => {
  const result = evaluateConstitutionalTransitionReview(valid());
  assert.equal(result.verdict, "INCOMPLETE");
  assert.deepEqual(result.missing, []);
  assert.equal(result.syntheticOnly.length, REQUIRED_TRANSITION_EVIDENCE_SLOTS.length);
  assert.equal(result.constitutionalDecisionAuthority, false);
  assert.equal(result.deploymentAuthority, false);
  assert.equal(result.activationAuthority, false);
  assert.equal(result.scaleUpAuthority, false);
  assert.equal(result.orderAuthorization, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("structurally complete external/human verified evidence is review eligible only", () => {
  const result = evaluateConstitutionalTransitionReview(valid({ evidence: evidence("EXTERNAL_HUMAN_VERIFIED") }));
  assert.equal(result.verdict, "READY_FOR_CONSTITUTIONAL_HUMAN_REVIEW");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.syntheticOnly, []);
  assert.match(result.packetFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.constitutionalDecisionAuthority, false);
  assert.equal(result.authorizesLive, false);
});

test("missing evidence remains explicit and incomplete", () => {
  const partial = evidence("EXTERNAL_HUMAN_VERIFIED").slice(0, 3);
  const result = evaluateConstitutionalTransitionReview(valid({ evidence: partial }));
  assert.equal(result.verdict, "INCOMPLETE");
  assert.equal(result.missing.length, REQUIRED_TRANSITION_EVIDENCE_SLOTS.length - 3);
  assert.ok(result.missing.includes("TINY_BOUNDED_LIVE_SESSION"));
});

test("FAIL outranks UNKNOWN and missing, while UNKNOWN outranks incomplete", () => {
  const mixed = evidence("EXTERNAL_HUMAN_VERIFIED");
  mixed[0] = { ...mixed[0], status: "FAIL" };
  mixed[1] = { ...mixed[1], status: "UNKNOWN" };
  const failed = evaluateConstitutionalTransitionReview(valid({ evidence: mixed.slice(0, 7) }));
  assert.equal(failed.verdict, "SAFE_BLOCK");
  assert.ok(failed.blockers.includes("SIGNED_PRODUCTION_ARTIFACT_FAIL"));

  const unknown = evidence("EXTERNAL_HUMAN_VERIFIED");
  unknown[2] = { ...unknown[2], status: "UNKNOWN" };
  const unknownResult = evaluateConstitutionalTransitionReview(valid({ evidence: unknown.slice(0, 7) }));
  assert.equal(unknownResult.verdict, "UNKNOWN");
  assert.ok(unknownResult.unknowns.includes("HUMAN_ACTIVATION_CEREMONY_UNKNOWN"));
});

test("packet fingerprint is deterministic across evidence input order", () => {
  const complete = evidence("EXTERNAL_HUMAN_VERIFIED");
  const first = evaluateConstitutionalTransitionReview(valid({ evidence: complete }));
  const second = evaluateConstitutionalTransitionReview(valid({ evidence: [...complete].reverse() }));
  assert.equal(first.packetFingerprint, second.packetFingerprint);
  const changed = evaluateConstitutionalTransitionReview(valid({ reviewId: "constitutional-review-2", evidence: complete }));
  assert.notEqual(first.packetFingerprint, changed.packetFingerprint);
});

test("duplicate evidence and secret-like references fail closed", () => {
  const duplicate = evidence();
  duplicate.push({ ...duplicate[0] });
  assert.throws(() => evaluateConstitutionalTransitionReview(valid({ evidence: duplicate })), /SLOT_DUPLICATE/);
  const secret = evidence();
  secret[0] = { ...secret[0], evidenceRef: "Bearer do-not-store-this" };
  assert.throws(() => evaluateConstitutionalTransitionReview(valid({ evidence: secret })), /SECRET_MATERIAL/);
});

test("source guard proves final packet cannot deploy activate trade or scale", () => {
  const validation = validateConstitutionalHumanTransitionReview();
  assert.equal(validation.ok, true, validation.failures.join(","));
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.syntheticEvidenceCannotSatisfyRealWorldGate, true);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.actualExternalBrokerValidationInCi, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.actualHumanCeremonyInCi, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.actualTinyLiveSessionInCi, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.automaticProductionTransitionAllowed, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.constitutionalDecisionAuthority, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.deploymentAuthority, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.activationAuthority, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.scaleUpAuthority, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.executionAuthority, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.authorizesLive, false);
  assert.equal(CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
