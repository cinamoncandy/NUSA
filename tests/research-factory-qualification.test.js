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

function stressScenario(id, overrides = {}) {
  const costs = {
    BASE: { feeRate: 0.0005, spreadBps: 5, slippageBps: 5 },
    MODERATE: { feeRate: 0.00075, spreadBps: 10, slippageBps: 10 },
    SEVERE: { feeRate: 0.001, spreadBps: 20, slippageBps: 30 },
  }[id];
  return {
    scenario: { id, ...costs },
    selectionMode: "FIX_BASELINE_SELECTION",
    markedTotalReturn: id === "BASE" ? 0.1 : id === "MODERATE" ? 0.09 : 0.08,
    markedMaximumDrawdown: id === "BASE" ? 0.08 : id === "MODERATE" ? 0.11 : 0.12,
    closedTradeNetProfit: 1000,
    closedTradeExpectancy: 100,
    closedTradeProfitFactor: 1.5,
    totalTradingCost: 100,
    benchmarkOutperformance: id === "BASE" ? 0.03 : 0.02,
    totalOosClosedTrades: 4,
    warnings: [],
    ...overrides,
  };
}

function costStress(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "VERIFIED",
    identity: {
      id: "7".repeat(64),
      sourceExperimentSha: "fixture:candidate-a",
      datasetSha256: "f".repeat(64),
      stressGridSha256: "8".repeat(64),
      selectionMode: "FIX_BASELINE_SELECTION",
      engineVersion: "execution-cost-stress-v1",
    },
    robustnessScore: 80,
    baselineScenarioId: "BASE",
    scenarioIds: ["BASE", "MODERATE", "SEVERE"],
    scenarios: [stressScenario("BASE"), stressScenario("MODERATE"), stressScenario("SEVERE")],
    warnings: [],
    ...overrides,
  };
}

const run = (overrides = {}) => ({
  schemaVersion: 1,
  evidenceMode: "RESEARCH_TIER_ONLY",
  provenance: {
    schemaVersion: 1,
    runFingerprintSha256: "d".repeat(64),
    sourceCommitSha: "e".repeat(40),
    costModelVersion: "cost-v1",
    dataset: {
      datasetId: "dataset-a",
      contentSha256: "f".repeat(64),
      source: "fixture",
      market: "KRW-BTC",
      interval: "1d",
      candleCount: 200,
      startOpenTime: 0,
      endCloseTime: 1,
    },
    candidateBindings: [{
      candidateId: "candidate-a",
      familyId: "family-a",
      lineageId: "family-a-v1",
      specificationHash: "a".repeat(64),
      datasetId: "dataset-a",
      datasetContentSha256: "f".repeat(64),
      parameters: { period: 14 },
    }],
    benchmarkIdentity: { kind: "BUY_AND_HOLD", evidenceSha256: "1".repeat(64) },
    evidenceIdentity: {
      pboSha256: "5".repeat(64),
      dsrSha256: "2".repeat(64),
      robustnessSha256: "6".repeat(64),
      regimeSha256: "3".repeat(64),
      oosObservationSha256: "4".repeat(64),
    },
    searchOverfittingIdentity: {
      evidenceSha256: "5".repeat(64),
      probabilityBacktestOverfitting: 0.25,
      datasetId: "dataset-a",
      datasetContentSha256: "f".repeat(64),
      market: "KRW-BTC",
      interval: "1d",
      candleCount: 200,
      startOpenTime: 0,
      endCloseTime: 1,
      candidateIds: ["candidate-a"],
      familyIds: ["family-a"],
      candidateSpecificationHashes: ["a".repeat(64)],
      candidateConfigurationSha256: "b".repeat(64),
      evaluationSha256: "c".repeat(64),
      oosTimestampSha256: "d".repeat(64),
    },
  },
  standing: {
    schemaVersion: 1,
    generatedAt: "2026-08-30T00:00:00.000Z",
    policy: {
      probabilityBacktestOverfittingPenaltyWeight: 200,
      regimeRobustnessThreshold: 0.5,
      fragileEvidenceDiscount: 0.25,
      insufficientRegimeEvidenceDiscount: 0.5,
    },
    probabilityBacktestOverfitting: 0.25,
    entries: [entry()],
    coverage: { candidateCount: 1, eligibleCount: 1, familyCount: 1 },
    provenance: { sourceDatasetIds: ["dataset-a"] },
  },
  evidenceReport: [report()],
  robustnessEvidence: {
    schemaVersion: 1,
    datasetId: "dataset-a",
    datasetContentSha256: "f".repeat(64),
    parameterRobustness: {
      references: [{
        source: "PRODUCTION_DEFAULT",
        familyId: "family-a",
        candidateKey: "candidate-a",
        parameters: { period: 14 },
        referenceReturn: 0.08,
        immediateNeighborCount: 4,
        immediateNeighborPositiveRatio: 0.75,
        immediateNeighborBenchmarkOutperformRatio: 0.75,
        allCandidatePositiveRatio: 0.6,
        signReversalRatio: 0.1,
        assessment: "BROAD_PLATEAU",
      }],
      provenance: {
        datasetId: "dataset-a",
        sourceCommitSha: "e".repeat(40),
        costModelVersion: "cost-v1",
      },
    },
    costStress: costStress(),
    candidateCostStress: [{
      candidateId: "candidate-a",
      familyId: "family-a",
      specificationHash: "a".repeat(64),
      costStress: costStress(),
    }],
  },
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

test("duplicate evidence reports fail closed", () => {
  const base = run();
  const secondEntry = entry({ id: "candidate-b", rank: 2 });
  const secondBinding = {
    ...base.provenance.candidateBindings[0],
    candidateId: "candidate-b",
  };
  assert.throws(
    () => qualifyResearchFactoryRun({
      ...base,
      standing: {
        ...base.standing,
        entries: [entry(), secondEntry],
      },
      provenance: {
        ...base.provenance,
        candidateBindings: [...base.provenance.candidateBindings, secondBinding],
      },
      evidenceReport: [
        report({ candidateId: "candidate-a" }),
        report({ candidateId: "candidate-b" }),
        report({ candidateId: "candidate-b" }),
      ],
    }),
    /research evidence report coverage mismatch/,
  );
});

test("missing run-level provenance fails closed before League qualification", () => {
  const invalid = run();
  delete invalid.provenance;
  assert.throws(() => qualifyResearchFactoryRun(invalid), /provenance is missing or malformed/);
});

test("duplicate candidate provenance bindings fail closed", () => {
  const invalid = run();
  invalid.provenance = {
    ...invalid.provenance,
    candidateBindings: [...invalid.provenance.candidateBindings, { ...invalid.provenance.candidateBindings[0] }],
  };
  assert.throws(() => qualifyResearchFactoryRun(invalid), /candidate provenance coverage mismatch/);
});


test("PBO above the frozen 0.5 threshold is a non-compensatory rejection", () => {
  const base = run();
  const result = qualifyResearchFactoryRun({
    ...base,
    standing: { ...base.standing, probabilityBacktestOverfitting: 0.6 },
    provenance: {
      ...base.provenance,
      searchOverfittingIdentity: {
        ...base.provenance.searchOverfittingIdentity,
        probabilityBacktestOverfitting: 0.6,
      },
    },
  });
  assert.equal(result.candidates[0].outcome, "REJECTED");
  assert.ok(result.candidates[0].reasons.includes("PBO_EXCEEDS_FROZEN_THRESHOLD"));
});

test("candidate-bound cost collapse rejects while missing or thin cost evidence stays insufficient", () => {
  const collapsed = run();
  const collapsedCost = collapsed.robustnessEvidence.candidateCostStress[0].costStress;
  collapsedCost.scenarios = collapsedCost.scenarios.map((scenario) => (
    scenario.scenario.id === "SEVERE"
      ? { ...scenario, closedTradeExpectancy: -1 }
      : scenario
  ));
  let result = qualifyResearchFactoryRun(collapsed);
  assert.equal(result.candidates[0].outcome, "REJECTED");
  assert.ok(result.candidates[0].reasons.includes("EXPECTANCY_TURNS_NEGATIVE"));

  const missing = run();
  missing.robustnessEvidence.candidateCostStress = [];
  result = qualifyResearchFactoryRun(missing);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("COST_STRESS_CANDIDATE_BINDING_REQUIRED"));

  const thin = run();
  const thinCost = thin.robustnessEvidence.candidateCostStress[0].costStress;
  thinCost.scenarios = thinCost.scenarios.map((scenario) => (
    scenario.scenario.id === "SEVERE"
      ? { ...scenario, totalOosClosedTrades: 1 }
      : scenario
  ));
  result = qualifyResearchFactoryRun(thin);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("INSUFFICIENT_CLOSED_TRADES"));
});

test("candidate-local parameter robustness is mandatory and non-compensatory", () => {
  const isolated = run();
  isolated.robustnessEvidence.parameterRobustness.references[0].immediateNeighborPositiveRatio = 0.25;
  isolated.robustnessEvidence.parameterRobustness.references[0].assessment = "ISOLATED_PEAK";
  let result = qualifyResearchFactoryRun(isolated);
  assert.equal(result.candidates[0].outcome, "REJECTED");
  assert.ok(result.candidates[0].reasons.includes("PARAMETER_ROBUSTNESS_ISOLATED_PEAK"));

  const missing = run();
  missing.robustnessEvidence.parameterRobustness.references = [];
  result = qualifyResearchFactoryRun(missing);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("PARAMETER_ROBUSTNESS_CANDIDATE_BINDING_REQUIRED"));
});

test("positive after-cost OOS and benchmark edge are mandatory", () => {
  const base = run();
  const badEntry = entry({
    components: { ...entry().components, outOfSamplePerformance: 0, benchmarkExcess: 0 },
  });
  const result = qualifyResearchFactoryRun({
    ...base,
    standing: { ...base.standing, entries: [badEntry] },
  });
  assert.equal(result.candidates[0].outcome, "REJECTED");
  assert.ok(result.candidates[0].reasons.includes("NON_POSITIVE_AFTER_COST_OOS_RETURN"));
  assert.ok(result.candidates[0].reasons.includes("NON_POSITIVE_BUY_AND_HOLD_OUTPERFORMANCE"));
});

test("cross-market or cross-timeframe PBO evidence cannot satisfy the same qualification vector", () => {
  for (const patch of [{ market: "KRW-ETH" }, { interval: "60m" }]) {
    const base = run();
    const result = qualifyResearchFactoryRun({
      ...base,
      provenance: {
        ...base.provenance,
        searchOverfittingIdentity: { ...base.provenance.searchOverfittingIdentity, ...patch },
      },
    });
    assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
    assert.ok(result.candidates[0].reasons.includes("PBO_PROVENANCE_MISMATCH"));
  }
});


test("malformed mandatory gate collections fail closed to insufficient", () => {
  const malformedPbo = run();
  malformedPbo.provenance.searchOverfittingIdentity.candidateIds = undefined;
  let result = qualifyResearchFactoryRun(malformedPbo);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("PBO_PROVENANCE_MISMATCH"));

  const malformedCost = run();
  malformedCost.robustnessEvidence.candidateCostStress = undefined;
  result = qualifyResearchFactoryRun(malformedCost);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("COST_STRESS_CANDIDATE_BINDING_REQUIRED"));

  const malformedParameter = run();
  malformedParameter.robustnessEvidence.parameterRobustness.references = undefined;
  result = qualifyResearchFactoryRun(malformedParameter);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("PARAMETER_ROBUSTNESS_CANDIDATE_BINDING_REQUIRED"));
});


test("candidate-bound cost survival never smears one candidate result across another", () => {
  const base = run();
  const candidateB = entry({
    id: "candidate-b",
    familyId: "family-a",
    rank: 2,
  });
  const bindingB = {
    candidateId: "candidate-b",
    familyId: "family-a",
    lineageId: "family-a-v1",
    specificationHash: "b".repeat(64),
    datasetId: "dataset-a",
    datasetContentSha256: "f".repeat(64),
    parameters: { period: 21 },
  };
  const candidateBCost = costStress({
    identity: {
      ...costStress().identity,
      id: "9".repeat(64),
      sourceExperimentSha: "fixture:candidate-b",
    },
    scenarios: costStress().scenarios.map((scenario) => (
      scenario.scenario.id === "SEVERE"
        ? { ...scenario, closedTradeExpectancy: -1 }
        : scenario
    )),
  });
  const multi = {
    ...base,
    provenance: {
      ...base.provenance,
      candidateBindings: [...base.provenance.candidateBindings, bindingB],
      searchOverfittingIdentity: {
        ...base.provenance.searchOverfittingIdentity,
        candidateIds: ["candidate-a", "candidate-b"],
        candidateSpecificationHashes: ["a".repeat(64), "b".repeat(64)],
      },
    },
    standing: {
      ...base.standing,
      entries: [entry(), candidateB],
      coverage: { candidateCount: 2, eligibleCount: 2, familyCount: 1 },
    },
    evidenceReport: [
      report(),
      report({ candidateId: "candidate-b" }),
    ],
    robustnessEvidence: {
      ...base.robustnessEvidence,
      parameterRobustness: {
        ...base.robustnessEvidence.parameterRobustness,
        references: [
          ...base.robustnessEvidence.parameterRobustness.references,
          {
            source: "PRECOMMITTED_CANDIDATE_LOCAL",
            familyId: "family-a",
            candidateKey: "candidate-b",
            parameters: { period: 21 },
            referenceReturn: 0.07,
            immediateNeighborCount: 3,
            immediateNeighborPositiveRatio: 0.67,
            immediateNeighborBenchmarkOutperformRatio: 0.67,
            allCandidatePositiveRatio: 0.6,
            signReversalRatio: 0.1,
            assessment: "NARROW_PLATEAU",
          },
        ],
      },
      candidateCostStress: [
        ...base.robustnessEvidence.candidateCostStress,
        {
          candidateId: "candidate-b",
          familyId: "family-a",
          specificationHash: "b".repeat(64),
          costStress: candidateBCost,
        },
      ],
    },
  };

  const result = qualifyResearchFactoryRun(multi);
  const byId = new Map(result.candidates.map((candidate) => [candidate.candidateId, candidate]));
  assert.equal(byId.get("candidate-a").outcome, "QUALIFIED_FOR_LEAGUE");
  assert.equal(byId.get("candidate-b").outcome, "REJECTED");
  assert.ok(byId.get("candidate-b").reasons.includes("EXPECTANCY_TURNS_NEGATIVE"));
  assert.equal(byId.get("candidate-a").reasons.includes("EXPECTANCY_TURNS_NEGATIVE"), false);
});


test("parameter assessment without comparable neighbor evidence stays insufficient", () => {
  const missingNeighbors = run();
  delete missingNeighbors.robustnessEvidence.parameterRobustness.references[0].immediateNeighborCount;
  let result = qualifyResearchFactoryRun(missingNeighbors);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("PARAMETER_ROBUSTNESS_NEIGHBOR_EVIDENCE_INSUFFICIENT"));

  const zeroNeighbors = run();
  zeroNeighbors.robustnessEvidence.parameterRobustness.references[0].immediateNeighborCount = 0;
  result = qualifyResearchFactoryRun(zeroNeighbors);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("PARAMETER_ROBUSTNESS_NEIGHBOR_EVIDENCE_INSUFFICIENT"));
});


test("cost stress from a different evaluation window cannot bind to canonical OOS", () => {
  const mismatched = run();
  const stress = mismatched.robustnessEvidence.candidateCostStress[0].costStress;
  stress.scenarios = stress.scenarios.map((scenario) => (
    scenario.scenario.id === "BASE"
      ? { ...scenario, markedTotalReturn: 0.11 }
      : scenario
  ));
  let result = qualifyResearchFactoryRun(mismatched);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("COST_STRESS_BASELINE_BINDING_MISMATCH"));

  const missingExpectancy = run();
  const missing = missingExpectancy.robustnessEvidence.candidateCostStress[0].costStress;
  missing.scenarios = missing.scenarios.map((scenario) => (
    scenario.scenario.id === "MODERATE"
      ? { ...scenario, closedTradeExpectancy: undefined }
      : scenario
  ));
  result = qualifyResearchFactoryRun(missingExpectancy);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("COST_STRESS_EXPECTANCY_EVIDENCE_MISSING"));
});


test("parameter assessment tampering fails closed instead of trusting the label", () => {
  const forged = run();
  forged.robustnessEvidence.parameterRobustness.references[0].assessment = "ISOLATED_PEAK";
  const result = qualifyResearchFactoryRun(forged);
  assert.equal(result.candidates[0].outcome, "INSUFFICIENT");
  assert.ok(result.candidates[0].reasons.includes("PARAMETER_ROBUSTNESS_ASSESSMENT_MISMATCH"));
});
