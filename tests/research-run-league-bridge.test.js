"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildResearchRunLeague, ResearchRunLeagueBridgeError } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");

// Mirrors the shape scripts/research-real-market-run.js actually produces via
// runWalkForwardExperiment, so these adversarial cases run through the real
// benchmark scorecard -> League ranking -> allocation advisory path rather than a stub.
function experiment(overrides = {}) {
  const market = overrides.market ?? "KRW-BTC";
  const interval = overrides.interval ?? "1d";
  const id = overrides.datasetId ?? `${market}-${interval}`;
  return {
    manifest: {
      schemaVersion: 1,
      datasetId: id,
      source: "fixture",
      market,
      interval,
      candleCount: overrides.candleCount ?? 200,
      startOpenTime: 0,
      endCloseTime: 1,
      timezone: "UTC",
      ordering: "OPEN_TIME_ASC",
      missingCandlePolicy: "REJECT",
      missingCandleCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      contentSha256: overrides.contentSha256 ?? `sha-${id}`
    },
    experimentConfig: { walkForward: {}, candidates: [], executionCosts: { feeRate: 0.0005, spreadBps: 5, slippageBps: 5 } },
    generatedAt: "2026-01-01T00:00:00.000Z",
    warnings: [],
    walkForwardResult: {
      windows: [],
      candidateSelectionCounts: {},
      warnings: [],
      stabilityDiagnostics: {
        candidates: [],
        selectionChurn: 0,
        selectionChurnRatio: overrides.selectionChurnRatio ?? 0.2
      },
      combinedOutOfSampleMetrics: {
        closedTradeNetProfit: 0,
        markedTotalReturn: overrides.totalReturn ?? 0.12,
        markedMaximumDrawdown: overrides.maximumDrawdown ?? 0.1,
        windowCount: overrides.windowCount ?? 4,
        totalOosPoints: overrides.totalOosPoints ?? 80,
        totalOosClosedTrades: overrides.totalOosClosedTrades ?? 8,
        netProfit: 0,
        totalReturn: overrides.totalReturn ?? 0.12,
        maximumDrawdown: overrides.maximumDrawdown ?? 0.1,
        winRate: 0.5,
        turnover: overrides.turnover ?? 1.5,
        exposure: 0.5,
        fees: 1000,
        spreadCost: 1000,
        slippageCost: 1000,
        totalTradingCost: overrides.totalTradingCost ?? 3000,
        profitableWindowRatio: overrides.profitableWindowRatio ?? 0.75,
        positiveExpectancyWindowRatio: 0.75,
        benchmarkOutperformanceWindowRatio: overrides.benchmarkOutperformanceWindowRatio ?? 0.75,
        equalWeight: {
          averageReturn: 0.03,
          averageBenchmarkReturn: overrides.averageBenchmarkReturn ?? 0.02,
          averageOutperformance: overrides.averageOutperformance ?? 0.01
        },
        sequentialCompounded: {
          initialEquity: overrides.initialEquity ?? 10_000_000,
          finalEquity: 11_200_000,
          totalReturn: overrides.totalReturn ?? 0.12,
          maximumDrawdown: overrides.maximumDrawdown ?? 0.1
        }
      }
    }
  };
}

const candidate = (id, familyId, overrides = {}) => {
  const result = experiment({ datasetId: `ds-${id}`, ...overrides });
  result.experimentConfig.candidates = [{ id }];
  return { id, familyId, experiment: result };
};


function regimeEvaluation(datasetId, overrides = {}) {
  return {
    schemaVersion: 1,
    datasetId,
    contentSha256: 'a'.repeat(64),
    generatedAt: '2026-08-26T06:00:00.000Z',
    policy: { minimumWindowsPerRegime: 2 },
    slices: [],
    observedRegimeCount: 2,
    sufficientRegimeCount: 2,
    regimeRobustnessScore: 0.9,
    reasons: [],
    sourceDatasetIds: [datasetId],
    ...overrides
  };
}

const entryOf = (result, id) => result.standing.entries.find((entry) => entry.id === id);

test("rejects candidate experiment identity mismatches before ranking aggregate evidence", () => {
  const mismatched = candidate("bridge-id", "family-a");
  mismatched.experiment.experimentConfig.candidates = [{ id: "different-candidate" }];

  assert.throws(
    () => buildResearchRunLeague([mismatched, candidate("other", "family-b")]),
    (error) => error instanceof ResearchRunLeagueError
      && error.code === "CANDIDATE_EXPERIMENT_IDENTITY_MISMATCH"
  );
});

test("bridges a real research run through benchmark scorecard, League ranking, and allocation", () => {
  const result = buildResearchRunLeague([
    candidate("sma-5-20", "sma-crossover"),
    candidate("meanrev-1", "mean-reversion", { totalReturn: 0.09 })
  ], { generatedAt: "2026-08-26T06:00:00.000Z" });

  assert.equal(result.evidenceMode, "RESEARCH_TIER_ONLY");
  // The League ranking is genuinely produced -- the pipeline is no longer dead code.
  assert.equal(result.standing.entries.length, 2);
  assert.ok(result.standing.entries.every((entry) => entry.leagueScore != null || !entry.eligible));
  // Research tier must never be mistaken for PAPER or LIVE evidence.
  assert.ok(result.reasons.includes("NOT_PAPER_EVIDENCE"));
  assert.ok(result.reasons.includes("RESEARCH_TIER_ONLY"));
});

test("refuses to allocate across candidates that carry only benchmark evidence", () => {
  // The real research run currently produces benchmark/OOS evidence only -- no DSR, regime,
  // ghost, counterfactual, or PAPER evidence -- so evidence breadth is 0. The allocation gate
  // must refuse rather than allocate across candidates nothing independent has corroborated,
  // and the ranking must survive that refusal instead of being thrown away with it.
  const result = buildResearchRunLeague([
    candidate("sma-5-20", "sma-crossover"),
    candidate("meanrev-1", "mean-reversion", { totalReturn: 0.09 })
  ]);
  assert.equal(result.allocation, undefined);
  assert.equal(result.allocationUnavailableReason, "NO_ALLOCATABLE_CANDIDATES");
  assert.ok(result.reasons.includes("NO_ALLOCATION_ADVISORY_AVAILABLE"));
  assert.equal(result.standing.entries.length, 2, "a refused allocation must not discard the ranking");
});

test("case C: a high return that fails to beat its benchmark is not treated as a normal candidate", () => {
  const result = buildResearchRunLeague([
    candidate("high-return-underperformer", "family-a", {
      totalReturn: 0.40,
      benchmarkOutperformanceWindowRatio: 0.1,
      averageOutperformance: -0.05
    }),
    candidate("steady", "family-b", { totalReturn: 0.06 })
  ]);
  const underperformer = entryOf(result, "high-return-underperformer");
  // Either the benchmark scorecard rules it ineligible, or its negative benchmark excess is
  // carried into the League components -- what must not happen is it looking clean.
  assert.ok(
    underperformer.eligible === false || underperformer.components.benchmarkExcess < 0,
    "benchmark underperformance must be visible, not smoothed away"
  );
});

test("case D: an excessive drawdown does not ride a big return into eligibility", () => {
  const result = buildResearchRunLeague([
    candidate("reckless", "family-a", { totalReturn: 0.50, maximumDrawdown: 0.60 }),
    candidate("measured", "family-b", { totalReturn: 0.08, maximumDrawdown: 0.05 })
  ]);
  const reckless = entryOf(result, "reckless");
  const measured = entryOf(result, "measured");
  assert.ok(
    reckless.eligible === false || (measured.rank != null && reckless.rank != null && measured.rank < reckless.rank),
    "a 60% drawdown must not outrank a measured candidate on raw return"
  );
});

test("case E: trading costs stay attached to the candidate that incurred them", () => {
  const result = buildResearchRunLeague([
    candidate("churner", "family-a", { totalReturn: 0.20, turnover: 40, totalTradingCost: 900_000, selectionChurnRatio: 0.9 }),
    candidate("patient", "family-b", { totalReturn: 0.10, turnover: 1.2, totalTradingCost: 2000 })
  ]);
  const churner = entryOf(result, "churner");
  // Cost/churn evidence must reach the League record rather than being dropped at the boundary.
  assert.ok(
    churner.eligible === false || churner.reasons.length > 0,
    "a high-turnover, high-cost candidate must carry its cost evidence into the League"
  );
});

test("case F: tuned variants of one family cannot own the whole research allocation", () => {
  const result = buildResearchRunLeague([
    candidate("sma-3-15", "sma-crossover", { totalReturn: 0.20 }),
    candidate("sma-5-15", "sma-crossover", { totalReturn: 0.19 }),
    candidate("sma-5-20", "sma-crossover", { totalReturn: 0.18 }),
    candidate("meanrev-1", "mean-reversion", { totalReturn: 0.10 }),
    candidate("meanrev-2", "mean-reversion", { totalReturn: 0.09 })
    // Breadth is relaxed here only to reach the family-cap logic under test; the cap itself,
    // not the breadth gate, is what this case is asserting.
  ], { allocationPolicy: { minimumEvidenceBreadth: 0 } });
  assert.ok(result.allocation, result.allocationUnavailableReason ?? "allocation expected");

  const byFamily = new Map();
  for (const entry of result.allocation.entries) {
    byFamily.set(entry.familyId, (byFamily.get(entry.familyId) ?? 0) + entry.researchWeight);
  }
  const cap = result.allocation.policy.maximumFamilyWeight;
  for (const [familyId, weight] of byFamily) {
    assert.ok(weight <= cap + 1e-9, `${familyId} holds ${weight}, above the family cap ${cap}`);
  }
});

test("a single-family research run is disclosed, never presented as diversified", () => {
  // This is the realistic shape of the real run: one strategy, several tunings.
  const result = buildResearchRunLeague([
    candidate("sma-3-15", "sma-crossover"),
    candidate("sma-5-20", "sma-crossover"),
    candidate("sma-8-20", "sma-crossover")
  ], { allocationPolicy: { minimumEvidenceBreadth: 0 } });
  assert.ok(result.reasons.includes("SINGLE_FAMILY_RESEARCH_RUN"));
  assert.ok(result.allocation.reasons.includes("SINGLE_FAMILY_EVIDENCE_BASE"));
  assert.equal(result.allocation.reasons.includes("FAMILY_CONCENTRATION_CAPPED"), false);
});

test("case G: provenance is carried end to end and mislabeled families are rejected", () => {
  const result = buildResearchRunLeague([
    candidate("a", "family-a"),
    candidate("b", "family-b")
  ]);
  assert.ok(result.standing.provenance.sourceDatasetIds.includes("ds-a"));
  assert.ok(result.standing.provenance.sourceDatasetIds.includes("ds-b"));

  for (const broken of [
    [{ id: "", familyId: "f", experiment: experiment() }],
    [{ id: "a", familyId: "  ", experiment: experiment() }],
    [candidate("dup", "f"), candidate("dup", "f")]
  ]) {
    assert.throws(() => buildResearchRunLeague(broken), ResearchRunLeagueBridgeError);
  }
  assert.throws(() => buildResearchRunLeague([]), ResearchRunLeagueBridgeError);
});

test("reports an unavailable allocation as a research finding instead of inventing one", () => {
  // Three variants of one family plus a single lone alternative cannot form a diversified book.
  const result = buildResearchRunLeague([
    candidate("sma-1", "sma-crossover", { totalReturn: 0.20 }),
    candidate("sma-2", "sma-crossover", { totalReturn: 0.19 }),
    candidate("sma-3", "sma-crossover", { totalReturn: 0.18 }),
    candidate("meanrev-1", "mean-reversion", { totalReturn: 0.10 })
  ], { allocationPolicy: { minimumEvidenceBreadth: 0 } });
  assert.equal(result.allocation, undefined);
  assert.equal(result.allocationUnavailableReason, "INSUFFICIENT_DIVERSIFICATION_CAPACITY");
  assert.ok(result.reasons.includes("NO_ALLOCATION_ADVISORY_AVAILABLE"));
  // The ranking is still valid research output and must survive the refusal.
  assert.equal(result.standing.entries.length, 4);
});

test("is deterministic and independent of candidate input order", () => {
  const build = () => [
    candidate("a", "family-a", { totalReturn: 0.12 }),
    candidate("b", "family-b", { totalReturn: 0.10 }),
    candidate("c", "family-c", { totalReturn: 0.08 })
  ];
  const forward = buildResearchRunLeague(build(), { generatedAt: "2026-08-26T06:00:00.000Z" });
  const reversed = buildResearchRunLeague(build().reverse(), { generatedAt: "2026-08-26T06:00:00.000Z" });
  const key = (result) => result.standing.entries
    .map((entry) => [entry.id, entry.rank, entry.leagueScore])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  assert.deepEqual(key(forward), key(reversed));
});


test("case A through the real bridge: a fragile single-regime winner does not outrank a robust candidate", () => {
  const fragile = candidate("fragile", "family-a", { totalReturn: 0.30 });
  fragile.regimeAwareEvaluation = regimeEvaluation("ds-fragile", { regimeRobustnessScore: 0.05 });
  const robust = candidate("robust", "family-b", { totalReturn: 0.08 });
  robust.regimeAwareEvaluation = regimeEvaluation("ds-robust", { regimeRobustnessScore: 0.95 });

  const result = buildResearchRunLeague([fragile, robust]);
  const fragileEntry = entryOf(result, "fragile");
  const robustEntry = entryOf(result, "robust");
  assert.equal(fragileEntry.components.regimeRobustness, 0.05);
  assert.equal(robustEntry.components.regimeRobustness, 0.95);
  assert.ok(
    robustEntry.rank < fragileEntry.rank,
    "a high raw return earned in one regime and given back in another must not outrank real cross-regime robustness"
  );
});

test("an INSUFFICIENT regime-aware result through the bridge does not inflate evidence breadth", () => {
  const thin = candidate("thin", "family-a");
  thin.regimeAwareEvaluation = regimeEvaluation("ds-thin", { regimeRobustnessScore: undefined, sufficientRegimeCount: 0 });
  const withoutRegime = candidate("bare", "family-b");

  const result = buildResearchRunLeague([thin, withoutRegime]);
  const thinEntry = entryOf(result, "thin");
  const bareEntry = entryOf(result, "bare");
  // INSUFFICIENT regime evidence must not count toward evidence breadth (fix in bb38cce4).
  assert.equal(thinEntry.evidenceBreadth, bareEntry.evidenceBreadth);
  assert.equal(thinEntry.components.regimeRobustness, undefined);
});

test("regime evidence that does not describe the candidate's own dataset fails closed through the bridge", () => {
  const mismatched = candidate("mismatched", "family-a");
  mismatched.regimeAwareEvaluation = regimeEvaluation("ds-someone-else");
  assert.throws(() => buildResearchRunLeague([mismatched, candidate("other", "family-b")]));
});

test("discloses when every candidate in the run carries point-in-time regime evidence", () => {
  const a = candidate("a", "family-a");
  a.regimeAwareEvaluation = regimeEvaluation("ds-a");
  const b = candidate("b", "family-b");
  b.regimeAwareEvaluation = regimeEvaluation("ds-b");
  const withRegime = buildResearchRunLeague([a, b]);
  assert.ok(withRegime.reasons.includes("POINT_IN_TIME_REGIME_EVIDENCE_PRESENT"));

  const withoutRegime = buildResearchRunLeague([candidate("c", "family-a"), candidate("d", "family-b")]);
  assert.equal(withoutRegime.reasons.includes("POINT_IN_TIME_REGIME_EVIDENCE_PRESENT"), false);
});

test("never introduces execution, broker, capital, or LIVE authority fields", () => {
  const result = buildResearchRunLeague([candidate("a", "family-a"), candidate("b", "family-b")]);
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ["liveauthority", "productionmutationallowed", "broker", "withdraw", "transfer", "notional", "capitalamount", "credential"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("projects existing contextual research evidence instead of dropping it at the real-run bridge", () => {
  const contextual = candidate("contextual", "family-context");
  const datasetId = contextual.experiment.manifest.datasetId;
  contextual.abstention = {
    schemaVersion: 1,
    asOf: 1_000,
    decision: "PROCEED_RESEARCH",
    netExpectedEdge: 0.01,
    effectiveMinimumConfidence: 0.6,
    reasons: [],
    sourceDatasetIds: [datasetId]
  };
  contextual.ghostExecution = {
    schemaVersion: 1,
    status: "SIMULATED",
    side: "LONG",
    entryTime: 1,
    exitTime: 2,
    holdingPeriodMs: 1,
    modeledEntryPrice: 100,
    modeledExitPrice: 102,
    grossReturn: 0.02,
    totalCostRate: 0.002,
    netReturn: 0.018,
    reasons: [],
    sourceDatasetIds: [datasetId]
  };
  contextual.counterfactual = {
    schemaVersion: 1,
    actualLabel: "ACTUAL_DECISION",
    actualNetReturn: 0.018,
    bestAlternativeLabel: "HOLD",
    bestAlternativeNetReturn: 0,
    regret: 0,
    relativeRank: 1,
    evaluatedOutcomeCount: 2,
    reasons: ["ACTUAL_WAS_BEST_OR_TIED"],
    sourceDatasetIds: [datasetId]
  };
  contextual.trialLedgerSummary = {
    trialCount: 4,
    completedCount: 3,
    failedCount: 1,
    rejectedCount: 0,
    distinctSearchCount: 1,
    distinctFamilyCount: 1,
    maximumSearchAttemptOrdinal: 4,
    terminalRecordHash: "a".repeat(64)
  };

  const result = buildResearchRunLeague([contextual, candidate("bare", "family-bare")]);
  const contextualEntry = entryOf(result, "contextual");
  const bareEntry = entryOf(result, "bare");

  assert.equal(contextualEntry.components.abstentionQuality, 1);
  assert.equal(contextualEntry.components.costAdjustedGhostReturn, 0.018);
  assert.equal(contextualEntry.components.counterfactualRegret, 0);
  assert.equal(contextualEntry.components.trialFailureRatio, 0.25);
  assert.ok(contextualEntry.evidenceBreadth > bareEntry.evidenceBreadth);
  assert.equal(bareEntry.components.costAdjustedGhostReturn, undefined);
});

test("fails closed when canonical OOS observations are malformed", () => {
  const invalid = candidate("invalid-oos", "family-invalid");
  invalid.experiment.experimentConfig.candidates = [{ id: "invalid-oos" }];
  invalid.experiment.walkForwardResult.windows = [{
    window: {
      index: 0,
      testPoints: [{ timestamp: 1, close: 100 }]
    },
    testResult: {
      decisions: [{
        timestamp: 1,
        market: "KRW-ETH",
        price: 100,
        signal: { type: "BUY", reason: "malformed-fixture", confidence: 0.8, timestamp: 1 },
        outcome: "FILLED",
        equityBefore: 10_000,
        equityAfter: 10_000,
        executionPrice: 100
      }]
    }
  }];

  assert.throws(
    () => buildResearchRunLeague([invalid, candidate("other-oos", "family-other")]),
    (error) => error instanceof ResearchRunLeagueBridgeError && error.code === "INVALID_OOS_OBSERVATION_EVIDENCE"
  );
});