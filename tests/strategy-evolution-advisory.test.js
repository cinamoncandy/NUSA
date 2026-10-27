const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  appendResearchMemorySemanticEvent,
} = require("../dist/packages/contracts/src/researchMemorySemantics.js");
const {
  evaluateStrategyEvolutionAdvisory,
  strategyEvolutionLifecycleSemanticIdentity,
} = require("../dist/apps/cloud/src/strategyEvolutionAdvisory.js");

const CURRENT_EVALUATOR = "research-evaluator:next-observation+warmup-v2";

const calibration = (overrides = {}) => ({
  calibrationId: "cal-865",
  decision: "CALIBRATED",
  confidenceAction: "ALLOW_INCREASE_WITH_NEW_INDEPENDENT_EVIDENCE",
  reasons: [],
  candidateId: "candidate-865",
  strategyFamilyId: "family-865",
  regime: "RISK_ON",
  verifiedPeriods: 30,
  independentEvidenceCount: 999,
  empiricalSuccessRate: 0.6,
  meanPredictedSuccessProbability: 0.58,
  brierScore: 0.2,
  meanExpectedNetEdge: 0.01,
  meanRealizedNetReturn: 0.012,
  calibrationGap: -0.02,
  evidenceFingerprintSha256: "a".repeat(64),
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  ...overrides,
});

const digest = (value) => createHash("sha256").update(value).digest("hex");
const authority = Object.freeze({
  authority: "PAPER_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

const lifecycleInput = (fact, group, id, overrides = {}) => ({
  artifact: {
    artifactKind: "EVALUATION_LEDGER_RECORD",
    artifactId: id,
    artifactContentSha256: digest(id),
    artifactDigestKind: "CANONICAL_EXISTING_SHA256",
  },
  semanticClass: "EVIDENCE",
  validity: "CURRENT",
  attribution: "SIGNAL",
  evidenceOrigin: "CANONICAL_RESEARCH",
  evaluatorSemanticsId: CURRENT_EVALUATOR,
  semanticIdentity: strategyEvolutionLifecycleSemanticIdentity("candidate-865", "family-865", fact),
  independenceGroupId: group,
  actor: "canonical-research",
  source: "research-evaluation-ledger",
  reason: fact,
  occurredAt: "2026-09-19T00:00:00.000Z",
  ...authority,
  ...overrides,
});

const lifecycleMemory = (entries = []) => {
  let records = [];
  for (const [index, entry] of entries.entries()) {
    records = appendResearchMemorySemanticEvent(
      records,
      lifecycleInput(entry.fact, entry.group, entry.id ?? `${entry.fact}-${entry.group}-${index}`, entry.overrides),
    );
  }
  return records;
};

const supports = (count) => Array.from({ length: count }, (_, index) => ({
  fact: "PROMOTION_SUPPORT",
  group: `support-${index}`,
  id: `support-${index}`,
}));

const input = (overrides = {}) => ({
  advisoryId: "evolve-865",
  currentState: "WATCH",
  evidence: {
    candidateId: "candidate-865",
    strategyFamilyId: "family-865",
    regime: "RISK_ON",
    calibration: calibration(),
    regimeEvidence: "VERIFIED",
    costEvidence: "VERIFIED",
    drawdownEvidence: "VERIFIED",
    provenanceEvidence: "VERIFIED",
    infrastructureEvidence: "VERIFIED",
    lifecycleMemory: lifecycleMemory(supports(4)),
    currentEvaluatorSemanticsId: CURRENT_EVALUATOR,
    minimumIndependentEvidenceForPromotion: 4,
  },
  ...overrides,
});

const withEvidence = (patch, currentState = "WATCH") => {
  const base = input();
  return { ...base, currentState, evidence: { ...base.evidence, ...patch } };
};

test("promotion is recommendation-only and requires canonical independent empirical support", () => {
  const result = evaluateStrategyEvolutionAdvisory(input());
  assert.equal(result.recommendation, "PROMOTE");
  assert.equal(result.recommendedState, "PROMOTED");
  assert.ok(result.reasons.includes("INDEPENDENT_VERIFIED_EVIDENCE_SUPPORTS_PROMOTION_RECOMMENDATION"));
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("fabricated caller counts and booleans cannot promote or retire without canonical memory", () => {
  const base = input();
  const evidence = {
    ...base.evidence,
    lifecycleMemory: [],
    repeatedFailureCount: 99,
    structurallyDominated: true,
    independentEvidenceCount: 99,
  };
  const result = evaluateStrategyEvolutionAdvisory({ ...base, evidence });
  assert.equal(result.recommendation, "HOLD");
  assert.ok(!result.reasons.includes("REPEATED_INDEPENDENT_FAILURES"));
  assert.ok(!result.reasons.includes("STRUCTURALLY_DOMINATED"));
});

test("provenance or infrastructure failure quarantines before retirement interpretation", () => {
  const failures = lifecycleMemory([
    { fact: "FAILURE", group: "search-a" },
    { fact: "FAILURE", group: "search-b" },
    { fact: "FAILURE", group: "search-c" },
  ]);
  for (const patch of [
    { provenanceEvidence: "FAILED", lifecycleMemory: failures },
    { infrastructureEvidence: "FAILED", lifecycleMemory: failures },
  ]) {
    const result = evaluateStrategyEvolutionAdvisory(withEvidence(patch, "PROMOTED"));
    assert.equal(result.recommendation, "QUARANTINE");
    assert.equal(result.recommendedState, "QUARANTINED");
    assert.ok(!result.reasons.includes("REPEATED_INDEPENDENT_FAILURES"));
  }
});

test("three independent CURRENT comparable canonical failures can retire", () => {
  const result = evaluateStrategyEvolutionAdvisory(withEvidence({
    lifecycleMemory: lifecycleMemory([
      { fact: "FAILURE", group: "search-a" },
      { fact: "FAILURE", group: "search-b" },
      { fact: "FAILURE", group: "search-c" },
    ]),
  }, "DEMOTED"));
  assert.equal(result.recommendation, "RETIRE");
  assert.ok(result.reasons.includes("REPEATED_INDEPENDENT_FAILURES"));
});

test("replays and multiple cells in one canonical search count once", () => {
  const result = evaluateStrategyEvolutionAdvisory(withEvidence({
    lifecycleMemory: lifecycleMemory([
      { fact: "FAILURE", group: "same-search", id: "cell-a" },
      { fact: "FAILURE", group: "same-search", id: "cell-b" },
      { fact: "FAILURE", group: "same-search", id: "cell-c" },
    ]),
  }, "DEMOTED"));
  assert.notEqual(result.recommendation, "RETIRE");
  assert.ok(!result.reasons.includes("REPEATED_INDEPENDENT_FAILURES"));
});

test("legacy, superseded, evaluator-mismatched or conflicting lifecycle evidence fails closed", () => {
  for (const overrides of [
    { validity: "SUPERSEDED" },
    { validity: "REVALIDATION_REQUIRED" },
    { evaluatorSemanticsId: "legacy:same-close+cold-start" },
  ]) {
    const result = evaluateStrategyEvolutionAdvisory(withEvidence({
      lifecycleMemory: lifecycleMemory([{ fact: "FAILURE", group: "legacy", overrides }]),
    }, "DEMOTED"));
    assert.equal(result.recommendation, "HOLD");
    assert.ok(result.reasons.includes("CANONICAL_LIFECYCLE_EVIDENCE_UNCERTAIN"));
  }
});

test("canonical structural domination evidence is required for RETIRE", () => {
  const result = evaluateStrategyEvolutionAdvisory(withEvidence({
    lifecycleMemory: lifecycleMemory([{ fact: "STRUCTURALLY_DOMINATED", group: "dominance-search" }]),
  }));
  assert.equal(result.recommendation, "RETIRE");
  assert.ok(result.reasons.includes("STRUCTURALLY_DOMINATED"));
});

test("corrupted canonical memory quarantines instead of interpreting lifecycle facts", () => {
  const valid = lifecycleMemory([{ fact: "FAILURE", group: "search-a" }]);
  const corrupted = [{ ...valid[0], hash: "0".repeat(64) }];
  const result = evaluateStrategyEvolutionAdvisory(withEvidence({ lifecycleMemory: corrupted }, "DEMOTED"));
  assert.equal(result.recommendation, "QUARANTINE");
  assert.ok(result.reasons.includes("CANONICAL_LIFECYCLE_MEMORY_INVALID"));
});

test("promoted strategy is demoted on calibration, regime, cost or drawdown deterioration", () => {
  const cases = [
    [{ calibration: calibration({ confidenceAction: "REDUCE" }) }, "CALIBRATION_DETERIORATION"],
    [{ regimeEvidence: "FAILED" }, "REGIME_DEGRADATION"],
    [{ costEvidence: "FAILED" }, "COST_EROSION"],
    [{ drawdownEvidence: "FAILED" }, "DRAWDOWN_DETERIORATION"],
  ];
  for (const [patch, reason] of cases) {
    const result = evaluateStrategyEvolutionAdvisory(withEvidence(patch, "PROMOTED"));
    assert.equal(result.recommendation, "DEMOTE");
    assert.ok(result.reasons.includes(reason));
  }
});

test("insufficient stale or conflicting non-lifecycle evidence fails closed", () => {
  for (const status of ["INSUFFICIENT", "STALE", "CONFLICTING"]) {
    const promoted = evaluateStrategyEvolutionAdvisory(withEvidence({ regimeEvidence: status }, "PROMOTED"));
    assert.equal(promoted.recommendation, "DEMOTE");
    const watch = evaluateStrategyEvolutionAdvisory(withEvidence({ costEvidence: status }, "WATCH"));
    assert.equal(watch.recommendation, "HOLD");
  }
});

test("retired state is terminal and never self-revives", () => {
  const result = evaluateStrategyEvolutionAdvisory({ ...input(), currentState: "RETIRED" });
  assert.equal(result.recommendation, "HOLD");
  assert.equal(result.recommendedState, "RETIRED");
});

test("promotion is blocked without enough canonical independent support or calibration permission", () => {
  const narrow = evaluateStrategyEvolutionAdvisory(withEvidence({ lifecycleMemory: lifecycleMemory(supports(3)) }));
  assert.equal(narrow.recommendation, "HOLD");
  const heldCalibration = evaluateStrategyEvolutionAdvisory(withEvidence({
    calibration: calibration({ confidenceAction: "HOLD" }),
  }));
  assert.equal(heldCalibration.recommendation, "HOLD");
});

test("learning explanation is deterministic and separates canonical evidence", () => {
  const patch = {
    costEvidence: "FAILED",
    regimeEvidence: "INSUFFICIENT",
    lifecycleMemory: lifecycleMemory(supports(2)),
  };
  const first = evaluateStrategyEvolutionAdvisory(withEvidence(patch));
  const second = evaluateStrategyEvolutionAdvisory(withEvidence(patch));
  assert.deepEqual(first.explanation, second.explanation);
  assert.equal(first.explanation.promotionBlocked, true);
  assert.ok(first.explanation.counterEvidence.includes("cost:FAILED"));
  assert.ok(first.explanation.missingEvidence.includes("regime:INSUFFICIENT"));
  assert.ok(first.explanation.missingEvidence.includes("independent-evidence:2/4"));
});

test("calibration identity and authority mismatches are rejected", () => {
  assert.throws(() => evaluateStrategyEvolutionAdvisory(withEvidence({ calibration: calibration({ regime: "RISK_OFF" }) })), /identity mismatch/);
  assert.throws(() => evaluateStrategyEvolutionAdvisory(withEvidence({ calibration: calibration({ liveAuthority: "FULL" }) })), /authority invariant/);
});
