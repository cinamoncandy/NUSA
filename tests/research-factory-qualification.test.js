const test = require("node:test");
const assert = require("node:assert/strict");
const { qualifyResearchFactoryRun } = require("../dist/apps/desktop/src/cloud/researchFactoryQualification.js");

const entry = (overrides = {}) => ({
  id: "candidate-a",
  familyId: "family-a",
  eligible: true,
  outcome: "QUALIFIED_FOR_LEAGUE",
  reasons: [],
  evidenceBreadth: 1,
  components: {
    outOfSamplePerformance: 0.1,
    benchmarkExcess: 0.03,
    maximumDrawdown: 0.08,
    turnover: 0.2,
    tradingCostBurden: 0.001,
    riskAdjusted: 0.99,
    regimeRobustness: 0.8,
    regimeRobustnessClass: "ROBUST",
    trialFailureRatio: 0.1,
  },
  leagueScore: 1,
  rank: 1,
  sourceDatasetIds: ["dataset-a"],
  ...overrides,
});

const report = (overrides = {}) => ({
  candidateId: "candidate-a",
  outcome: "QUALIFIED_FOR_LEAGUE",
  summary: "complete evidence",
  supportingEvidence: [
    "OUT_OF_SAMPLE_BENCHMARK_EVIDENCE",
    "DEFLATED_SHARPE_EVIDENCE",
    "COST_SENSITIVITY_EVIDENCE",
    "PBO_EVIDENCE",
    "REGIME_ROBUSTNESS_EVIDENCE",
    "TRIAL_LEDGER_EVIDENCE",
  ],
  counterEvidence: [],
  missingEvidence: [
    "ABSTENTION_EVIDENCE_MISSING",
    "GHOST_EXECUTION_EVIDENCE_MISSING",
    "COUNTERFACTUAL_EVIDENCE_MISSING",
    "PAPER_PERFORMANCE_EVIDENCE_MISSING",
  ],
  costSensitivity: { status: "AVAILABLE", turnover: 0.2, tradingCostBurden: 0.001 },
  overfitRisk: "AVAILABLE",
  ...overrides,
});

const run = (overrides = {}) => ({
  schemaVersion: 1,
  evidenceMode: "RESEARCH_TIER_ONLY",
  standing: {
    schemaVersion: 1,
    generatedAt: "2026-08-30T00:00:00.000Z",
    policy: {
      probabilityBacktestOverfittingPenaltyWeight: 200,
      regimeRobustnessThreshold: 0.5,
      fragileEvidenceDiscount: 0.25,
      insufficientRegimeEvidenceDiscount: 0.5,
    },
    entries: [entry()],
    coverage: { candidateCount: 1, eligibleCount: 1, familyCount: 1 },
    provenance: { sourceDatasetIds: ["dataset-a"] },
  },
  evidenceReport: [report()],
  robustnessEvidence: { schemaVersion: 1 },
  hypothesis: { schemaVersion: 1 },
  reasons: [
    "RESEARCH_TIER_ONLY",
    "NO_EXECUTION_AUTHORITY",
    "OOS_OBSERVATION_PROVENANCE_PRESENT",
    "SEARCH_OVERFITTING_EVIDENCE_PRESENT",
    "PARAMETER_ROBUSTNESS_EVIDENCE_PRESENT",
    "COST_STRESS_EVIDENCE_PRESENT",
    "PRECOMMITTED_HYPOTHESIS_PRESENT",
  ],
  oosObservationEvidence: { "candidate-a": [] },
  ...overrides,
});

test("qualifies only when canonical research evidence is complete", () => {
  const result = qualifyResearchFactoryRun(run());
  assert.equal(result.candidates[0].outcome, "QUALIFIED_FOR_LEAGUE");
  assert.deepEqual(result.candidates[0].reasons, []);
  assert.equal(result.coverage.qualifiedCount, 1);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.candidates));
});

test("missing DSR PBO cost regime trial-ledger hypothesis robustness or OOS provenance stays insufficient", () => {
  const cases = [
    { missing: "DEFLATED_SHARPE_EVIDENCE_MISSING" },
    { missing: "PBO_EVIDENCE_MISSING" },
    { missing: "COST_SENSITIVITY_EVIDENCE_MISSING" },
    { missing: "REGIME_ROBUSTNESS_EVIDENCE_INSUFFICIENT" },
    { missing: "TRIAL_LEDGER_EVIDENCE_MISSING" },
  ];
  for (const item of cases) {
    const result = qualifyResearchFactoryRun(run({ evidenceReport: [report({ missingEvidence: [item.missing] })] }));
    assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
    assert.ok(result.candidates[0].reasons.includes(item.missing));
  }

  const noHypothesis = qualifyResearchFactoryRun(run({ hypothesis: undefined }));
  assert.equal(noHypothesis.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(noHypothesis.candidates[0].reasons.includes("PRECOMMITTED_HYPOTHESIS_REQUIRED"));

  const noRobustness = qualifyResearchFactoryRun(run({ robustnessEvidence: undefined }));
  assert.equal(noRobustness.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(noRobustness.candidates[0].reasons.includes("PARAMETER_AND_COST_STRESS_EVIDENCE_REQUIRED"));

  const noOosTrace = qualifyResearchFactoryRun(run({ reasons: ["RESEARCH_TIER_ONLY"] }));
  assert.equal(noOosTrace.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(noOosTrace.candidates[0].reasons.includes("OOS_OBSERVATION_PROVENANCE_REQUIRED"));
});

test("explicit statistical or regime failure is rejected rather than relabeled insufficient", () => {
  for (const reason of ["DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD", "REGIME_FRAGILE_EDGE"]) {
    const rejectedEntry = entry({ reasons: [reason] });
    const result = qualifyResearchFactoryRun(run({
      standing: { ...run().standing, entries: [rejectedEntry] },
    }));
    assert.equal(result.candidates[0].outcome, "REJECTED");
    assert.ok(result.candidates[0].reasons.includes(reason));
  }
});

test("baseline benchmark rejection and insufficiency remain fail closed", () => {
  const rejected = entry({ eligible: false, outcome: "REJECTED", leagueScore: undefined, rank: undefined });
  const rejectedResult = qualifyResearchFactoryRun(run({
    standing: { ...run().standing, entries: [rejected] },
    evidenceReport: [report({ outcome: "REJECTED" })],
  }));
  assert.equal(rejectedResult.candidates[0].outcome, "REJECTED");

  const insufficient = entry({ eligible: false, outcome: "INSUFFICIENT", leagueScore: undefined, rank: undefined });
  const insufficientResult = qualifyResearchFactoryRun(run({
    standing: { ...run().standing, entries: [insufficient] },
    evidenceReport: [report({ outcome: "INSUFFICIENT" })],
  }));
  assert.equal(insufficientResult.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(insufficientResult.candidates[0].reasons.includes("INSUFFICIENT_OOS_BENCHMARK_EVIDENCE"));
});

test("mismatched human-readable evidence coverage fails closed", () => {
  assert.throws(() => qualifyResearchFactoryRun(run({ evidenceReport: [] })), /coverage mismatch/);
  assert.throws(() => qualifyResearchFactoryRun(run({ evidenceReport: [report({ outcome: "REJECTED" })] })), /outcome mismatch/);
});
