"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { learnFromPaperAbstentionOutcome } = require("../dist/apps/cloud/src/abstentionOutcomeLearning.js");

const baseObservation = (overrides = {}) => ({
  observationId: "obs-1",
  candidateId: "cand-1",
  strategyFamilyId: "fam-1",
  regime: "RISK_ON",
  abstainedAt: "2026-08-30T00:00:00.000Z",
  observedAt: "2026-08-30T01:00:00.000Z",
  abstentionReasons: ["INSUFFICIENT_CONFIDENCE"],
  counterfactualGrossReturn: 0.03,
  estimatedRoundTripCost: 0.002,
  counterfactualAdverseExcursion: 0.005,
  evidenceStatus: "VERIFIED",
  source: "PAPER",
  independentEvidenceId: "ind-1",
  ...overrides,
});

const input = (overrides = {}) => ({
  learningId: "learn-1",
  evaluatedAt: "2026-08-30T02:00:00.000Z",
  maximumEvidenceAgeMs: 86_400_000,
  missedOpportunityThreshold: 0.01,
  materialAdverseExcursionThreshold: 0.02,
  observation: baseObservation(),
  ...overrides,
});

test("identifies a potential missed PAPER opportunity after costs without claiming realized PnL", () => {
  const result = learnFromPaperAbstentionOutcome(input());
  assert.equal(result.classification, "POTENTIAL_MISSED_OPPORTUNITY");
  assert.equal(result.researchAction, "REVIEW_ABSTENTION_THRESHOLD");
  assert.equal(result.counterfactualNetReturn, 0.028);
  assert.ok(result.reasons.includes("COUNTERFACTUAL_NET_EDGE_AFTER_COSTS"));
  assert.equal(result.realizedPnlClaimAllowed, false);
  assert.equal(result.lifecycleMutationAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("classifies abstention as correct when it avoided material counterfactual risk", () => {
  const result = learnFromPaperAbstentionOutcome(input({
    observation: baseObservation({
      counterfactualGrossReturn: 0.004,
      counterfactualAdverseExcursion: 0.05,
    }),
  }));
  assert.equal(result.classification, "CORRECT_ABSTENTION");
  assert.equal(result.researchAction, "REINFORCE_ABSTENTION_POLICY");
  assert.ok(result.reasons.includes("ABSTENTION_AVOIDED_MATERIAL_RISK"));
});

test("returns ambiguous when both missed edge and counterfactual risk are material", () => {
  const result = learnFromPaperAbstentionOutcome(input({
    observation: baseObservation({ counterfactualAdverseExcursion: 0.04 }),
  }));
  assert.equal(result.classification, "AMBIGUOUS");
  assert.equal(result.researchAction, "COLLECT_MORE_EVIDENCE");
  assert.ok(result.reasons.includes("EDGE_AND_RISK_BOTH_MATERIAL"));
});

test("unverified or chronologically invalid evidence fails closed", () => {
  const unverified = learnFromPaperAbstentionOutcome(input({
    observation: baseObservation({ evidenceStatus: "UNKNOWN" }),
  }));
  assert.equal(unverified.classification, "INSUFFICIENT_EVIDENCE");
  assert.equal(unverified.counterfactualNetReturn, null);
  assert.equal(unverified.evidenceFingerprintSha256, null);

  const future = learnFromPaperAbstentionOutcome(input({
    observation: baseObservation({ observedAt: "2026-08-31T01:00:00.000Z" }),
  }));
  assert.equal(future.classification, "INSUFFICIENT_EVIDENCE");
  assert.ok(future.reasons.includes("FUTURE_EVIDENCE"));
});

test("fingerprint is deterministic across abstention reason ordering", () => {
  const left = learnFromPaperAbstentionOutcome(input({
    observation: baseObservation({ abstentionReasons: ["LOW_EDGE", "LOW_CONFIDENCE"] }),
  }));
  const right = learnFromPaperAbstentionOutcome(input({
    observation: baseObservation({ abstentionReasons: ["LOW_CONFIDENCE", "LOW_EDGE"] }),
  }));
  assert.match(left.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.equal(left.evidenceFingerprintSha256, right.evidenceFingerprintSha256);
});

test("rejects non-PAPER evidence and malformed numeric evidence", () => {
  assert.throws(
    () => learnFromPaperAbstentionOutcome(input({ observation: baseObservation({ source: "LIVE" }) })),
    /only PAPER abstention evidence/,
  );
  assert.throws(
    () => learnFromPaperAbstentionOutcome(input({ observation: baseObservation({ estimatedRoundTripCost: -0.01 }) })),
    /estimatedRoundTripCost must be non-negative/,
  );
});
