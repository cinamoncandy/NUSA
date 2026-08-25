"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { appendResearchTrial } = require("../dist/apps/desktop/src/cloud/researchTrialLedger.js");
const {
  ResearchStatisticalEvidenceError,
  calculateDeflatedSharpeEvidence,
  estimateProbabilityBacktestOverfitting
} = require("../dist/apps/desktop/src/cloud/researchSearchAdjustedEvidence.js");

const HASH = "b".repeat(64);

function trial({ trialId, ordinal, sharpeRatio, outcome = "COMPLETED" }) {
  return {
    trialId,
    familyId: "momentum-family",
    hypothesis: `trial ${trialId}`,
    createdAt: `2026-08-25T00:00:0${ordinal}.000Z`,
    dataset: { datasetId: "dataset-1", contentSha256: HASH, market: "KRW-BTC", interval: "1d" },
    candidateIds: [`candidate-${trialId}`],
    search: { searchId: "search-1", attemptOrdinal: ordinal },
    outcome,
    ...(sharpeRatio == null ? {} : { metrics: { sharpeRatio } })
  };
}

function ledgerWithAttempts(includeExtraFailure = false) {
  let ledger = appendResearchTrial([], trial({ trialId: "trial-1", ordinal: 1, sharpeRatio: 0.2 }));
  ledger = appendResearchTrial(ledger, trial({ trialId: "trial-2", ordinal: 2, sharpeRatio: 0.4 }));
  ledger = appendResearchTrial(ledger, trial({ trialId: "trial-3", ordinal: 3, outcome: "FAILED" }));
  if (includeExtraFailure) ledger = appendResearchTrial(ledger, trial({ trialId: "trial-4", ordinal: 4, outcome: "FAILED" }));
  return ledger;
}

test("DSR uses the full recorded search count, including failed attempts", () => {
  const base = calculateDeflatedSharpeEvidence({
    ledger: ledgerWithAttempts(false),
    searchId: "search-1",
    selectedTrialId: "trial-2",
    sampleLength: 100,
    skewness: 0,
    kurtosis: 3
  });
  const withHiddenFailurePrevented = calculateDeflatedSharpeEvidence({
    ledger: ledgerWithAttempts(true),
    searchId: "search-1",
    selectedTrialId: "trial-2",
    sampleLength: 100,
    skewness: 0,
    kurtosis: 3
  });

  assert.equal(base.searchTrialCount, 3);
  assert.equal(base.completedSharpeTrialCount, 2);
  assert.equal(base.observedSharpe, 0.4);
  assert.ok(base.deflatedSharpeProbability > 0 && base.deflatedSharpeProbability < 1);
  assert.equal(base.passes, base.deflatedSharpeProbability >= 0.95);
  assert.equal(withHiddenFailurePrevented.searchTrialCount, 4);
  assert.ok(withHiddenFailurePrevented.expectedMaximumSharpe > base.expectedMaximumSharpe);
  assert.ok(withHiddenFailurePrevented.deflatedSharpeProbability < base.deflatedSharpeProbability);
});

test("DSR fails closed when selected evidence or search breadth is insufficient", () => {
  const one = appendResearchTrial([], trial({ trialId: "trial-1", ordinal: 1, sharpeRatio: 0.4 }));
  assert.throws(
    () => calculateDeflatedSharpeEvidence({ ledger: one, searchId: "search-1", selectedTrialId: "trial-1", sampleLength: 100, skewness: 0, kurtosis: 3 }),
    (error) => error instanceof ResearchStatisticalEvidenceError && error.code === "INSUFFICIENT_SEARCH_TRIALS"
  );

  const ledger = ledgerWithAttempts(false);
  assert.throws(
    () => calculateDeflatedSharpeEvidence({ ledger, searchId: "search-1", selectedTrialId: "trial-3", sampleLength: 100, skewness: 0, kurtosis: 3 }),
    (error) => error instanceof ResearchStatisticalEvidenceError && error.code === "SELECTED_TRIAL_NOT_COMPLETED"
  );
});

test("CSCV PBO is zero when one strategy dominates every symmetric split", () => {
  const evidence = estimateProbabilityBacktestOverfitting({
    partitions: 4,
    strategies: [
      { strategyId: "robust", returns: [0.02, 0.01, 0.018, 0.012, 0.021, 0.009, 0.019, 0.011, 0.022, 0.008, 0.017, 0.013, 0.02, 0.01, 0.018, 0.012] },
      { strategyId: "weak", returns: [0.005, -0.005, 0.004, -0.004, 0.006, -0.006, 0.003, -0.003, 0.005, -0.005, 0.004, -0.004, 0.006, -0.006, 0.003, -0.003] }
    ]
  });

  assert.equal(evidence.partitions, 4);
  assert.equal(evidence.splitCount, 6);
  assert.equal(evidence.overfitSplitCount, 0);
  assert.equal(evidence.probabilityBacktestOverfitting, 0);
  assert.ok(evidence.splits.every((split) => split.selectedStrategyId === "robust" && split.logit > 0));
});

test("CSCV PBO flags regime-fit strategies that reverse out of sample", () => {
  const evidence = estimateProbabilityBacktestOverfitting({
    partitions: 4,
    strategies: [
      { strategyId: "left", returns: [0.05, 0.04, 0.04, 0.03, -0.04, -0.05, -0.03, -0.04] },
      { strategyId: "right", returns: [-0.05, -0.04, -0.04, -0.03, 0.04, 0.05, 0.03, 0.04] }
    ]
  });

  assert.equal(evidence.splitCount, 6);
  assert.equal(evidence.probabilityBacktestOverfitting, 1);
  assert.equal(evidence.overfitSplitCount, 6);
  assert.ok(evidence.medianLogit <= 0);
});

test("CSCV rejects asymmetric or under-specified evidence", () => {
  assert.throws(
    () => estimateProbabilityBacktestOverfitting({
      partitions: 4,
      strategies: [
        { strategyId: "a", returns: [0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2] },
        { strategyId: "b", returns: [0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1] }
      ]
    }),
    (error) => error instanceof ResearchStatisticalEvidenceError && error.code === "UNEQUAL_RETURN_LENGTHS"
  );

  assert.throws(
    () => estimateProbabilityBacktestOverfitting({
      partitions: 6,
      strategies: [
        { strategyId: "a", returns: Array.from({ length: 16 }, (_, index) => index % 2 ? 0.01 : 0.02) },
        { strategyId: "b", returns: Array.from({ length: 16 }, (_, index) => index % 2 ? -0.01 : 0.01) }
      ]
    }),
    (error) => error instanceof ResearchStatisticalEvidenceError && error.code === "UNEQUAL_PARTITIONS"
  );
});
