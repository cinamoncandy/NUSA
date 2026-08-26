import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateLeague, NusaLeagueError, type LeagueCandidateInput } from "./nusaLeague";
import type { ResearchBenchmarkSliceScore } from "./researchBenchmarkScorecard";
import type { DeflatedSharpeEvidence, PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { RegimeHealthAssessment } from "./regimeHealth";
import type { AbstentionAssessment } from "./abstentionEngine";
import type { GhostExecutionResult } from "./ghostExecution";
import type { CounterfactualAssessment } from "./counterfactualEngine";
import type { ResearchTrialLedgerSummary } from "./researchTrialLedger";

function benchmark(overrides: Partial<ResearchBenchmarkSliceScore> = {}): ResearchBenchmarkSliceScore {
  return {
    id: "candidate-a",
    datasetId: "dataset-a",
    contentSha256: "a".repeat(64),
    market: "KRW-BTC",
    interval: "60m",
    candleCount: 500,
    windowCount: 4,
    totalOosPoints: 40,
    totalOosClosedTrades: 8,
    totalReturn: 0.08,
    maximumDrawdown: 0.05,
    averageBenchmarkReturn: 0.02,
    averageOutperformance: 0.03,
    profitableWindowRatio: 0.75,
    benchmarkOutperformanceWindowRatio: 0.75,
    turnover: 1.2,
    totalTradingCost: 0.001,
    tradingCostBurden: 0.001,
    selectionChurnRatio: 0.1,
    eligible: true,
    reasons: [],
    researchScore: 42,
    ...overrides,
  };
}

function regime(overrides: Partial<RegimeHealthAssessment> = {}): RegimeHealthAssessment {
  return {
    schemaVersion: 1,
    asOf: 1_000,
    state: "HEALTHY",
    score: 0.8,
    components: { breadth: 0.7, medianReturn: 0.02, medianDrawdown: -0.05, medianVolatility: 0.01, dispersion: 0.02 },
    reasons: ["BROAD_POSITIVE_PARTICIPATION"],
    sourceDatasetIds: ["dataset-a"],
    ...overrides,
  };
}

function abstention(overrides: Partial<AbstentionAssessment> = {}): AbstentionAssessment {
  return {
    schemaVersion: 1,
    asOf: 1_000,
    decision: "PROCEED_RESEARCH",
    netExpectedEdge: 0.01,
    effectiveMinimumConfidence: 0.6,
    reasons: [],
    sourceDatasetIds: ["dataset-a"],
    ...overrides,
  };
}

function ghost(overrides: Partial<GhostExecutionResult> = {}): GhostExecutionResult {
  return {
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
    sourceDatasetIds: ["dataset-a"],
    ...overrides,
  };
}

function counterfactual(overrides: Partial<CounterfactualAssessment> = {}): CounterfactualAssessment {
  return {
    schemaVersion: 1,
    actualLabel: "ACTUAL_DECISION",
    actualNetReturn: 0.018,
    regret: 0,
    relativeRank: 1,
    evaluatedOutcomeCount: 1,
    reasons: ["ACTUAL_WAS_BEST_OR_TIED"],
    sourceDatasetIds: ["dataset-a"],
    ...overrides,
  };
}

function trialLedgerSummary(overrides: Partial<ResearchTrialLedgerSummary> = {}): ResearchTrialLedgerSummary {
  return {
    trialCount: 10,
    completedCount: 6,
    failedCount: 2,
    rejectedCount: 2,
    distinctSearchCount: 3,
    distinctFamilyCount: 1,
    maximumSearchAttemptOrdinal: 4,
    terminalRecordHash: "b".repeat(64),
    ...overrides,
  };
}

function pbo(overrides: Partial<PboCscvEvidence> = {}): PboCscvEvidence {
  return {
    strategyCount: 3,
    observationCount: 32,
    partitions: 8,
    splitCount: 70,
    overfitSplitCount: 10,
    probabilityBacktestOverfitting: 10 / 70,
    medianLogit: 0.4,
    splits: [],
    ...overrides,
  };
}

function fullCandidate(id = "candidate-a", overrides: Partial<LeagueCandidateInput> = {}): LeagueCandidateInput {
  return {
    id,
    familyId: "family-1",
    benchmark: benchmark({ id }),
    deflatedSharpe: {
      searchId: "search-1",
      selectedTrialId: id,
      observedSharpe: 1.2,
      searchTrialCount: 5,
      completedSharpeTrialCount: 5,
      trialSharpeStdDev: 0.2,
      expectedMaximumSharpe: 0.6,
      zScore: 2.1,
      deflatedSharpeProbability: 0.97,
      confidenceThreshold: 0.95,
      passes: true,
    } as DeflatedSharpeEvidence,
    regime: regime(),
    abstention: abstention(),
    ghostExecution: ghost(),
    counterfactual: counterfactual(),
    trialLedgerSummary: trialLedgerSummary(),
    ...overrides,
  };
}

describe("evaluateLeague", () => {
  it("ranks candidates by the composed evidence score and reuses provenance from every source", () => {
    const standing = evaluateLeague([
      fullCandidate("candidate-a"),
      fullCandidate("candidate-b", { benchmark: benchmark({ id: "candidate-b", datasetId: "dataset-b", totalReturn: 0.02, averageOutperformance: 0.005 }), deflatedSharpe: undefined, regime: regime({ sourceDatasetIds: ["dataset-b"] }), abstention: abstention({ sourceDatasetIds: ["dataset-b"] }), ghostExecution: ghost({ sourceDatasetIds: ["dataset-b"], netReturn: 0.001 }), counterfactual: counterfactual({ sourceDatasetIds: ["dataset-b"], actualNetReturn: 0.001 }) }),
    ]);

    assert.equal(standing.entries.length, 2);
    assert.equal(standing.coverage.candidateCount, 2);
    assert.equal(standing.coverage.eligibleCount, 2);
    const [first, second] = standing.entries;
    assert.equal(first!.id, "candidate-a");
    assert.equal(first!.rank, 1);
    assert.equal(second!.id, "candidate-b");
    assert.equal(second!.rank, 2);
    assert.ok(first!.leagueScore! > second!.leagueScore!);
    assert.deepEqual(standing.provenance.sourceDatasetIds, ["dataset-a", "dataset-b"]);
  });

  it("never disqualifies a sound ABSTAIN decision and never fabricates a ghost return for it", () => {
    const abstained = fullCandidate("candidate-c", {
      benchmark: benchmark({ id: "candidate-c" }),
      abstention: abstention({ decision: "ABSTAIN", netExpectedEdge: -0.001, reasons: ["INSUFFICIENT_NET_EDGE"] }),
      ghostExecution: ghost({ status: "SKIPPED", reasons: ["ABSTENTION_BLOCKED"], modeledEntryPrice: undefined, modeledExitPrice: undefined, grossReturn: undefined, totalCostRate: undefined, netReturn: undefined }),
      counterfactual: undefined,
    });
    const standing = evaluateLeague([abstained]);
    const entry = standing.entries[0]!;
    assert.equal(entry.eligible, true);
    assert.equal(entry.components.costAdjustedGhostReturn, undefined);
    assert.equal(entry.components.abstentionQuality, 1);
    assert.ok(entry.reasons.includes("ABSTAINED_SOUND_DECISION"));
    assert.ok(entry.reasons.includes("GHOST_EXECUTION_SKIPPED_BY_ABSTENTION"));
  });

  it("marks a benchmark-ineligible candidate ineligible and excludes it from ranks without discarding it", () => {
    const standing = evaluateLeague([
      fullCandidate("candidate-a"),
      fullCandidate("candidate-bad", { benchmark: benchmark({ id: "candidate-bad", eligible: false, reasons: ["MAXIMUM_DRAWDOWN_EXCEEDED"], researchScore: undefined }) }),
    ]);
    const bad = standing.entries.find((entry) => entry.id === "candidate-bad")!;
    assert.equal(bad.eligible, false);
    assert.equal(bad.rank, undefined);
    assert.equal(bad.leagueScore, undefined);
    assert.ok(bad.reasons.includes("MAXIMUM_DRAWDOWN_EXCEEDED"));
    assert.equal(standing.coverage.eligibleCount, 1);
    assert.equal(standing.coverage.candidateCount, 2);
  });

  it("considers the trial ledger's failed/rejected attempts as a scored component, not hidden evidence", () => {
    const cleanRecord = fullCandidate("candidate-clean", { trialLedgerSummary: trialLedgerSummary({ failedCount: 0, rejectedCount: 0, completedCount: 10, trialCount: 10 }) });
    const messyRecord = fullCandidate("candidate-messy", { benchmark: benchmark({ id: "candidate-messy" }), trialLedgerSummary: trialLedgerSummary({ failedCount: 8, rejectedCount: 1, completedCount: 1, trialCount: 10 }) });
    const standing = evaluateLeague([cleanRecord, messyRecord]);
    const clean = standing.entries.find((entry) => entry.id === "candidate-clean")!;
    const messy = standing.entries.find((entry) => entry.id === "candidate-messy")!;
    assert.equal(clean.components.trialFailureRatio, 0);
    assert.ok(messy.components.trialFailureRatio! > 0.5);
    assert.ok(clean.leagueScore! > messy.leagueScore!);
  });

  it("applies one shared probability-of-backtest-overfitting penalty across the whole league", () => {
    const withoutPbo = evaluateLeague([fullCandidate("candidate-a")]);
    const withPbo = evaluateLeague([fullCandidate("candidate-a")], { probabilityBacktestOverfitting: pbo() });
    assert.equal(withPbo.probabilityBacktestOverfitting, pbo().probabilityBacktestOverfitting);
    assert.ok(withPbo.entries[0]!.leagueScore! < withoutPbo.entries[0]!.leagueScore!);
  });

  it("fails closed on broken or mismatched evidence instead of silently ignoring it", () => {
    assert.throws(() => evaluateLeague([]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a"), fullCandidate("candidate-a")]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { deflatedSharpe: { ...fullCandidate("candidate-a").deflatedSharpe!, selectedTrialId: "someone-else" } })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { regime: regime({ sourceDatasetIds: ["unrelated-dataset"] }) })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { counterfactual: counterfactual({ regret: Number.NaN }) })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a")], { probabilityBacktestOverfitting: pbo({ probabilityBacktestOverfitting: 1.5 }) }), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { trialLedgerSummary: trialLedgerSummary({ completedCount: 20 }) })]), NusaLeagueError);
  });

  it("never produces an order, broker call, or LIVE/capital-allocation authority", () => {
    const standing = evaluateLeague([fullCandidate("candidate-a")]);
    const serialized = JSON.stringify(standing).toLowerCase();
    for (const forbidden of ["liveauthority", "productionmutationallowed", "order", "broker", "withdraw", "transfer", "activationlease"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});
