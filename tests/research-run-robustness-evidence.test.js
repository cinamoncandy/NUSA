"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  buildResearchRunRobustnessEvidence,
  ResearchRunRobustnessEvidenceError,
} = require("../dist/apps/desktop/src/cloud/researchRunRobustnessEvidence.js");
const {
  buildResearchRunLeague,
  ResearchRunLeagueBridgeError,
} = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const {
  buildResearchHypothesis,
} = require("../dist/apps/desktop/src/cloud/researchHypothesis.js");

const DATASET_SHA = "a".repeat(64);
const REQUEST_SHA = "b".repeat(64);
const SOURCE_SHA = "c".repeat(40);

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
    markedMaximumDrawdown: id === "BASE" ? 0.1 : id === "MODERATE" ? 0.11 : 0.12,
    closedTradeNetProfit: 1000,
    closedTradeExpectancy: 100,
    closedTradeProfitFactor: 1.5,
    totalTradingCost: id === "BASE" ? 100 : id === "MODERATE" ? 150 : 200,
    benchmarkOutperformance: 0.02,
    totalOosClosedTrades: 4,
    warnings: [],
    ...overrides,
  };
}

function costStressIdentity(sourceExperimentSha = "real-run:real-run-dataset") {
  const grid = ["BASE", "MODERATE", "SEVERE"].map((id) => {
    const scenario = stressScenario(id).scenario;
    return {
      id: scenario.id,
      feeRate: scenario.feeRate,
      spreadBps: scenario.spreadBps,
      slippageBps: scenario.slippageBps,
      latencyMs: scenario.latencyMs ?? 0,
    };
  });
  const stressGridSha256 = createHash("sha256").update(JSON.stringify(grid)).digest("hex");
  const engineVersion = "execution-cost-stress-v1";
  const selectionMode = "FIX_BASELINE_SELECTION";
  const id = createHash("sha256")
    .update(`${sourceExperimentSha}|${DATASET_SHA}|${stressGridSha256}|${selectionMode}|${engineVersion}`)
    .digest("hex");
  return {
    id,
    sourceExperimentSha,
    datasetSha256: DATASET_SHA,
    stressGridSha256,
    selectionMode,
    engineVersion,
  };
}

function rawEvidence(overrides = {}) {
  return {
    datasetId: "real-run-dataset",
    datasetContentSha256: DATASET_SHA,
    parameterRobustness: {
      status: "PASS",
      requestId: "real-run:real-run-dataset:parameter-robustness",
      hashes: {
        requestSha256: REQUEST_SHA,
        datasetContentSha256: DATASET_SHA,
      },
      dataset: { datasetContentSha256: DATASET_SHA },
      references: [
        { source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20, assessment: "BROAD_PLATEAU" },
      ],
      aggregate: {
        candidateCount: 25,
        validCandidateCount: 24,
        invalidCandidateCount: 1,
        positiveRatio: 0.5,
        medianReturn: 0.02,
        returnIqr: 0.03,
        worstReturn: -0.04,
        bestReturn: 0.12,
        costSurvivorCounts: { BASE: 12, MODERATE: 8, SEVERE: 3 },
      },
      warnings: ["REFERENCE_ISOLATED_PEAK"],
      verification: { status: "PASS" },
      provenance: {
        datasetId: "real-run-dataset",
        sourceCommitSha: SOURCE_SHA,
        costModelVersion: "paper-cost-v1",
        datasetContentSha256: DATASET_SHA,
      },
    },
    costStress: {
      identity: costStressIdentity(),
      selectionMode: "FIX_BASELINE_SELECTION",
      baseline: stressScenario("BASE"),
      scenarios: [stressScenario("SEVERE"), stressScenario("BASE"), stressScenario("MODERATE")],
      robustnessScore: 64,
      warnings: ["BREAK_EVEN_NOT_FOUND"],
    },
    candidateCostStress: [],
    ...overrides,
  };
}

function experiment(candidateId, datasetId = "real-run-dataset") {
  const windows = Array.from({ length: 4 }, (_, index) => {
    const benchmarkReturn = 0.02;
    const outperformance = index < 3 ? 0.013333333333333334 : 0;
    const strategyReturn = benchmarkReturn + outperformance;
    return {
      testResult: {
        metrics: { totalReturn: strategyReturn, benchmarkReturn, excessReturn: outperformance, outperformance },
        benchmark: { strategyReturn, buyAndHoldReturn: benchmarkReturn, outperformance },
      },
    };
  });
  return {
    manifest: {
      schemaVersion: 1,
      datasetId,
      source: "fixture",
      market: "KRW-BTC",
      interval: "1d",
      candleCount: 200,
      startOpenTime: 0,
      endCloseTime: 1,
      timezone: "UTC",
      ordering: "OPEN_TIME_ASC",
      missingCandlePolicy: "REJECT",
      missingCandleCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      contentSha256: DATASET_SHA,
    },
    experimentConfig: {
      walkForward: {},
      candidates: [{ id: candidateId }],
      executionCosts: { feeRate: 0.0005, spreadBps: 5, slippageBps: 5 },
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
    warnings: [],
    walkForwardResult: {
      windows,
      candidateSelectionCounts: {},
      warnings: [],
      stabilityDiagnostics: { candidates: [], selectionChurn: 0, selectionChurnRatio: 0 },
      combinedOutOfSampleMetrics: {
        closedTradeNetProfit: 1000,
        markedTotalReturn: 0.12,
        markedMaximumDrawdown: 0.1,
        windowCount: 4,
        totalOosPoints: 80,
        totalOosClosedTrades: 8,
        netProfit: 1000,
        totalReturn: 0.12,
        maximumDrawdown: 0.1,
        winRate: 0.5,
        turnover: 1.5,
        exposure: 0.5,
        fees: 1000,
        spreadCost: 1000,
        slippageCost: 1000,
        totalTradingCost: 3000,
        profitableWindowRatio: 0.75,
        positiveExpectancyWindowRatio: 0.75,
        benchmarkOutperformanceWindowRatio: 0.75,
        equalWeight: { averageReturn: 0.03, averageBenchmarkReturn: 0.02, averageOutperformance: 0.01 },
        sequentialCompounded: { initialEquity: 10_000_000, finalEquity: 11_200_000, totalReturn: 0.12, maximumDrawdown: 0.1 },
      },
    },
  };
}

function candidate(id, datasetId = "real-run-dataset") {
  const candidateExperiment = experiment(id, datasetId);
  return {
    id,
    familyId: "sma-crossover",
    experiment: candidateExperiment,
    candidateSpecification: {
      schemaVersion: 1,
      candidateId: id,
      familyId: "sma-crossover",
      lineageId: "sma-crossover-v1",
      parameters: {},
      codeSha: SOURCE_SHA,
      datasetId,
      datasetContentSha256: DATASET_SHA,
      costModelVersion: "paper-cost-v1",
      generatedAt: "2025-12-31T23:00:00.000Z",
      evaluationStartedAt: "2025-12-31T23:05:00.000Z",
      evaluationEndedAt: "2025-12-31T23:30:00.000Z",
    },
  };
}

test("projects verified parameter and cost evidence deterministically at run level", () => {
  const first = buildResearchRunRobustnessEvidence(rawEvidence());
  const second = buildResearchRunRobustnessEvidence(rawEvidence());

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.datasetId, "real-run-dataset");
  assert.deepEqual(first.parameterRobustness.references.map((reference) => reference.source), ["PRODUCTION_DEFAULT"]);
  assert.deepEqual(first.costStress.scenarioIds, ["BASE", "MODERATE", "SEVERE"]);
  assert.equal(first.parameterRobustness.provenance.sourceCommitSha, SOURCE_SHA);
  assert.equal(first.costStress.robustnessScore, 64);
  assert.equal(first.costStress.scenarios.find((scenario) => scenario.scenario.id === "BASE").totalOosClosedTrades, 4);
  assert.deepEqual(first.candidateCostStress, []);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.parameterRobustness));
  assert.ok(Object.isFrozen(first.costStress));
});

test("missing verification or mismatched dataset provenance never becomes robustness evidence", () => {
  assert.throws(
    () => buildResearchRunRobustnessEvidence(rawEvidence({
      parameterRobustness: { ...rawEvidence().parameterRobustness, verification: { status: "FAIL" } },
    })),
    (error) => error instanceof ResearchRunRobustnessEvidenceError && error.code === "PARAMETER_ROBUSTNESS_NOT_VERIFIED",
  );
  assert.throws(
    () => buildResearchRunRobustnessEvidence(rawEvidence({
      costStress: {
        ...rawEvidence().costStress,
        identity: { ...rawEvidence().costStress.identity, datasetSha256: "f".repeat(64) },
      },
    })),
    (error) => error instanceof ResearchRunRobustnessEvidenceError && error.code === "COST_STRESS_DATASET_MISMATCH",
  );
});

test("League accepts run-level robustness without inflating candidate evidence breadth or ranking", () => {
  const evidence = buildResearchRunRobustnessEvidence(rawEvidence());
  const candidates = [candidate("sma-5-20"), candidate("sma-8-20")];
  const without = buildResearchRunLeague(candidates);
  const withEvidence = buildResearchRunLeague(candidates, { robustnessEvidence: evidence });

  assert.deepEqual(withEvidence.standing, without.standing);
  assert.deepEqual(
    withEvidence.standing.entries.map((entry) => entry.evidenceBreadth),
    without.standing.entries.map((entry) => entry.evidenceBreadth),
  );
  assert.ok(withEvidence.reasons.includes("PARAMETER_ROBUSTNESS_EVIDENCE_PRESENT"));
  assert.ok(withEvidence.reasons.includes("COST_STRESS_EVIDENCE_PRESENT"));
  assert.deepEqual(withEvidence.robustnessEvidence, evidence);
});

test("League preserves a precommitted hypothesis without changing ranking", () => {
  const hypothesis = buildResearchHypothesis({
    hypothesisId: "real-run:real-run-dataset:sma-crossover",
    familyId: "sma-crossover",
    market: "KRW-BTC",
    interval: "1d",
    direction: "LONG",
    thesis: "A short/long SMA crossover may identify a reproducible directional edge after costs.",
    sourceDatasetId: "real-run-dataset",
    sourceObservationAsOf: 0,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const candidates = [candidate("sma-5-20"), candidate("sma-8-20")];
  const without = buildResearchRunLeague(candidates);
  const withHypothesis = buildResearchRunLeague(candidates, { hypothesis });

  assert.deepEqual(withHypothesis.standing, without.standing);
  assert.deepEqual(withHypothesis.hypothesis, hypothesis);
  assert.ok(withHypothesis.reasons.includes("PRECOMMITTED_HYPOTHESIS_PRESENT"));
});

test("League rejects robustness evidence when candidate datasets are not one shared run", () => {
  const evidence = buildResearchRunRobustnessEvidence(rawEvidence());
  assert.throws(
    () => buildResearchRunLeague([candidate("btc"), candidate("eth", "other-dataset")], { robustnessEvidence: evidence }),
    (error) => error instanceof ResearchRunLeagueBridgeError && error.code === "ROBUSTNESS_PROVENANCE_MISMATCH",
  );
});


test("robustness evidence preserves family-generic parameter references", () => {
  const input = rawEvidence();
  input.parameterRobustness.references = [{
    source: "PRODUCTION_DEFAULT",
    familyId: "rsi-mean-reversion",
    candidateKey: "rsi-14-30-70",
    parameters: { period: 14, oversold: 30, overbought: 70 },
    assessment: "BROAD_PLATEAU",
  }];
  const evidence = buildResearchRunRobustnessEvidence(input);
  assert.deepEqual(evidence.parameterRobustness.references, [{
    source: "PRODUCTION_DEFAULT",
    familyId: "rsi-mean-reversion",
    candidateKey: "rsi-14-30-70",
    parameters: { overbought: 70, oversold: 30, period: 14 },
    assessment: "BROAD_PLATEAU",
  }]);
});


test("preserves candidate-bound cost-stress facts without smearing family evidence", () => {
  const input = rawEvidence({
    candidateCostStress: [{
      candidateId: "candidate-a",
      familyId: "family-a",
      specificationHash: "9".repeat(64),
      costStress: {
        ...rawEvidence().costStress,
        identity: costStressIdentity("real-run:real-run-dataset:family-a:candidate-a"),
      },
    }],
  });
  const evidence = buildResearchRunRobustnessEvidence(input);
  assert.equal(evidence.candidateCostStress.length, 1);
  assert.equal(evidence.candidateCostStress[0].candidateId, "candidate-a");
  assert.equal(evidence.candidateCostStress[0].specificationHash, "9".repeat(64));
  assert.deepEqual(evidence.candidateCostStress[0].costStress.scenarioIds, ["BASE", "MODERATE", "SEVERE"]);
  assert.equal(
    evidence.candidateCostStress[0].costStress.scenarios.find((scenario) => scenario.scenario.id === "SEVERE").benchmarkOutperformance,
    0.02,
  );
});


test("tampered cost-stress grid hash or derived identity is rejected", () => {
  const badGrid = rawEvidence();
  badGrid.costStress.identity = {
    ...badGrid.costStress.identity,
    stressGridSha256: "f".repeat(64),
  };
  assert.throws(
    () => buildResearchRunRobustnessEvidence(badGrid),
    (error) => error instanceof ResearchRunRobustnessEvidenceError
      && error.code === "COST_STRESS_GRID_HASH_MISMATCH",
  );

  const badId = rawEvidence();
  badId.costStress.identity = {
    ...badId.costStress.identity,
    id: "f".repeat(64),
  };
  assert.throws(
    () => buildResearchRunRobustnessEvidence(badId),
    (error) => error instanceof ResearchRunRobustnessEvidenceError
      && error.code === "COST_STRESS_IDENTITY_MISMATCH",
  );
});
