"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildResearchRunPboEvidence, ResearchRunPboEvidenceError } = require("../dist/apps/desktop/src/cloud/researchRunPboEvidence.js");
const { buildResearchRunDsrEvidence, ResearchRunDsrEvidenceError } = require("../dist/apps/desktop/src/cloud/researchRunDsrEvidence.js");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");

function equityCurve(candidateIndex, windowIndex) {
  let equity = 10_000_000;
  const points = [];
  for (let index = 0; index < 20; index += 1) {
    if (index > 0) {
      const sign = (index + windowIndex + candidateIndex) % 4 === 0 ? -1 : 1;
      const magnitude = 0.0005 + candidateIndex * 0.00015 + (index % 3) * 0.00007;
      equity *= 1 + sign * magnitude;
    }
    points.push({ timestamp: windowIndex * 1000 + index + 1, equity });
  }
  return points;
}

function experiment(id, candidateIndex, overrides = {}) {
  const datasetId = overrides.datasetId ?? "shared-dataset";
  const contentSha256 = overrides.contentSha256 ?? "a".repeat(64);
  const windows = Array.from({ length: 4 }, (_, windowIndex) => ({
    window: {
      index: windowIndex,
      trainStart: 0,
      trainEnd: 0,
      testStart: 0,
      testEnd: 0,
      trainPoints: [],
      testPoints: []
    },
    selectedCandidateId: id,
    trainResult: { metrics: { totalReturn: 0 } },
    candidateTrainScores: [],
    selectionReason: "fixture",
    testResult: {
      equityCurve: equityCurve(candidateIndex, windowIndex),
      metrics: { totalReturn: 0.01, maxDrawdown: 0.02, turnover: 1, totalTradingCost: 100 },
      trades: [],
      performance: { expectancy: 1 },
      benchmark: { buyAndHoldReturn: 0.005, outperformance: 0.005 },
      openPosition: { status: "FLAT" }
    }
  }));

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
      contentSha256
    },
    experimentConfig: {
      walkForward: {},
      candidates: [{ id }],
      executionCosts: { spreadBps: 5, slippageBps: 5 }
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
    warnings: [],
    walkForwardResult: {
      windows,
      candidateSelectionCounts: { [id]: 4 },
      warnings: [],
      stabilityDiagnostics: {
        candidates: [],
        selectionChurn: 0,
        selectionChurnRatio: 0
      },
      combinedOutOfSampleMetrics: {
        closedTradeNetProfit: 1000,
        markedTotalReturn: 0.04,
        markedMaximumDrawdown: 0.02,
        windowCount: 4,
        totalOosPoints: 80,
        totalOosClosedTrades: 4,
        netProfit: 1000,
        totalReturn: 0.04 + candidateIndex * 0.005,
        maximumDrawdown: 0.02,
        winRate: 0.5,
        turnover: 1,
        exposure: 0.5,
        fees: 100,
        spreadCost: 100,
        slippageCost: 100,
        totalTradingCost: 300,
        profitableWindowRatio: 0.75,
        positiveExpectancyWindowRatio: 0.75,
        benchmarkOutperformanceWindowRatio: 0.75,
        equalWeight: {
          averageReturn: 0.01,
          averageBenchmarkReturn: 0.005,
          averageOutperformance: 0.005
        },
        sequentialCompounded: {
          initialEquity: 10_000_000,
          finalEquity: 10_400_000,
          totalReturn: 0.04,
          maximumDrawdown: 0.02
        }
      }
    }
  };
}

function candidates() {
  return [0, 1, 2].map((index) => ({
    id: `candidate-${index}`,
    familyId: `family-${index}`,
    experiment: experiment(`candidate-${index}`, index)
  }));
}

test("derives CSCV PBO from aligned cost-aware OOS equity returns only", () => {
  const evidence = buildResearchRunPboEvidence(candidates());
  assert.equal(evidence.strategyCount, 3);
  assert.equal(evidence.observationCount, 76, "4 windows x 19 within-window returns; no cross-window synthetic return");
  assert.equal(evidence.partitions, 4);
  assert.ok(evidence.splitCount > 0);
  assert.ok(evidence.probabilityBacktestOverfitting >= 0 && evidence.probabilityBacktestOverfitting <= 1);
});

test("threads search-overfitting evidence through the real-run League bridge", () => {
  const input = candidates();
  const pbo = buildResearchRunPboEvidence(input);
  const result = buildResearchRunLeague(input, {
    probabilityBacktestOverfitting: pbo,
    allocationPolicy: { minimumEvidenceBreadth: 0 },
    generatedAt: "2026-08-26T07:45:00.000Z"
  });
  assert.equal(result.standing.probabilityBacktestOverfitting, pbo.probabilityBacktestOverfitting);
  assert.ok(result.reasons.includes("SEARCH_OVERFITTING_EVIDENCE_PRESENT"));
});

test("derives candidate-specific DSR from the real cost-aware OOS search ledger", () => {
  const input = candidates();
  const result = buildResearchRunDsrEvidence(input);
  assert.equal(result.evidenceByCandidate.size, input.length);
  assert.equal(result.unavailableReasons.size, 0);
  for (const candidate of input) {
    const dsr = result.evidenceByCandidate.get(candidate.id);
    assert.equal(dsr.selectedTrialId, candidate.id);
    assert.equal(dsr.searchTrialCount, input.length);
    assert.equal(dsr.completedSharpeTrialCount, input.length);
    assert.ok(dsr.deflatedSharpeProbability >= 0 && dsr.deflatedSharpeProbability <= 1);
  }
});

test("threads DSR into League as candidate evidence without granting authority", () => {
  const input = candidates();
  const dsr = buildResearchRunDsrEvidence(input);
  const result = buildResearchRunLeague(input.map((candidate) => ({ ...candidate, deflatedSharpe: dsr.evidenceByCandidate.get(candidate.id) })));
  assert.ok(result.standing.entries.every((entry) => entry.evidenceBreadth === 0.125));
  assert.ok(result.standing.entries.every((entry) => entry.components.riskAdjusted != null));
  assert.equal(result.allocation, undefined, "one honest evidence category must not unlock allocation");
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ["liveauthority", "broker", "order", "credential", "withdraw", "transfer"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("DSR fails closed on candidate identity and dataset provenance mismatch", () => {
  const identityMismatch = candidates();
  identityMismatch[1] = { ...identityMismatch[1], experiment: experiment("wrong-id", 1) };
  assert.throws(() => buildResearchRunDsrEvidence(identityMismatch), ResearchRunPboEvidenceError);

  const provenanceMismatch = candidates();
  provenanceMismatch[2] = { ...provenanceMismatch[2], experiment: experiment(provenanceMismatch[2].id, 2, { datasetId: "other-dataset" }) };
  assert.throws(
    () => buildResearchRunDsrEvidence(provenanceMismatch),
    (error) => error instanceof ResearchRunDsrEvidenceError && error.code === "DATASET_PROVENANCE_MISMATCH"
  );
});

test("DSR preserves a zero-variance candidate as unavailable without inventing evidence", () => {
  const input = candidates();
  const flat = experiment(input[2].id, 2);
  for (const window of flat.walkForwardResult.windows) {
    window.testResult.equityCurve.forEach((point) => { point.equity = 10_000_000; });
  }
  input[2] = { ...input[2], experiment: flat };
  const result = buildResearchRunDsrEvidence(input);
  assert.equal(result.evidenceByCandidate.size, 2);
  assert.equal(result.unavailableReasons.get(input[2].id), "ZERO_OOS_RETURN_VARIANCE");
  for (const candidate of input.slice(0, 2)) {
    assert.equal(result.evidenceByCandidate.get(candidate.id).searchTrialCount, 3, "rejected attempts remain in the search denominator");
  }
});

test("fails closed on dataset provenance mismatch", () => {
  const input = candidates();
  input[2] = { ...input[2], experiment: experiment(input[2].id, 2, { datasetId: "other-dataset" }) };
  assert.throws(() => buildResearchRunPboEvidence(input), (error) => error instanceof ResearchRunPboEvidenceError && error.code === "DATASET_PROVENANCE_MISMATCH");
});

test("fails closed when a candidate experiment does not describe that candidate", () => {
  const input = candidates();
  input[1] = { ...input[1], experiment: experiment("wrong-id", 1) };
  assert.throws(() => buildResearchRunPboEvidence(input), (error) => error instanceof ResearchRunPboEvidenceError && error.code === "CANDIDATE_EXPERIMENT_IDENTITY_MISMATCH");
});

test("fails closed on OOS timestamp misalignment", () => {
  const input = candidates();
  const broken = experiment(input[1].id, 1);
  broken.walkForwardResult.windows[0].testResult.equityCurve[5].timestamp += 5000;
  input[1] = { ...input[1], experiment: broken };
  assert.throws(() => buildResearchRunPboEvidence(input), ResearchRunPboEvidenceError);
});

test("fails closed when an OOS window baseline timestamp is non-finite", () => {
  const input = candidates();
  const broken = experiment(input[0].id, 0);
  broken.walkForwardResult.windows[0].testResult.equityCurve[0].timestamp = Number.NaN;
  input[0] = { ...input[0], experiment: broken };
  assert.throws(
    () => buildResearchRunPboEvidence(input),
    (error) => error instanceof ResearchRunPboEvidenceError && error.code === "INVALID_OOS_TIMESTAMP"
  );
});

test("fails closed when OOS windows overlap or move backward in time", () => {
  const input = candidates();
  const broken = experiment(input[0].id, 0);
  const previousEnd = broken.walkForwardResult.windows[0].testResult.equityCurve.at(-1).timestamp;
  broken.walkForwardResult.windows[1].testResult.equityCurve.forEach((point, index) => {
    point.timestamp = previousEnd - 10 + index;
  });
  input[0] = { ...input[0], experiment: broken };
  assert.throws(
    () => buildResearchRunPboEvidence(input),
    (error) => error instanceof ResearchRunPboEvidenceError && error.code === "NON_MONOTONIC_OOS_WINDOWS"
  );
});

test("PBO evidence does not manufacture candidate evidence breadth or execution authority", () => {
  const input = candidates();
  const pbo = buildResearchRunPboEvidence(input);
  const result = buildResearchRunLeague(input, { probabilityBacktestOverfitting: pbo });
  assert.ok(result.standing.entries.every((entry) => entry.evidenceBreadth === 0), "league-wide PBO must not masquerade as candidate-specific breadth");
  assert.equal(result.allocation, undefined);
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ["liveauthority", "broker", "order", "capitalamount", "credential", "withdraw", "transfer"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("preserves the DSR search ledger summary and rejected attempts for League projection", () => {
  const input = candidates();
  const flat = experiment(input[2].id, 2);
  for (const window of flat.walkForwardResult.windows) {
    window.testResult.equityCurve.forEach((point) => { point.equity = 10_000_000; });
  }
  input[2] = { ...input[2], experiment: flat };

  const dsr = buildResearchRunDsrEvidence(input);
  assert.equal(dsr.trialLedgerSummary.trialCount, 3);
  assert.equal(dsr.trialLedgerSummary.completedCount, 2);
  assert.equal(dsr.trialLedgerSummary.rejectedCount, 1);
  assert.equal(dsr.trialLedgerSummary.failedCount, 0);

  const league = buildResearchRunLeague(input.map((candidate) => ({
    ...candidate,
    deflatedSharpe: dsr.evidenceByCandidate.get(candidate.id),
    trialLedgerSummary: dsr.trialLedgerSummary
  })));
  const rejectedCandidate = league.standing.entries.find((entry) => entry.id === input[2].id);
  assert.equal(rejectedCandidate.components.trialFailureRatio, 1 / 3);
});
