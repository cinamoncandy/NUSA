import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateLeague, NusaLeagueError, type LeagueCandidateInput } from "./nusaLeague";
import type { ResearchBenchmarkSliceScore } from "./researchBenchmarkScorecard";
import type { DeflatedSharpeEvidence, PboCscvEvidence } from "./researchSearchAdjustedEvidence";
import type { RegimeHealthAssessment } from "./regimeHealth";
import type { RegimeAwareStrategyEvaluation } from "./regimeAwareStrategyEvaluation";
import type { AbstentionAssessment } from "./abstentionEngine";
import type { GhostExecutionResult } from "./ghostExecution";
import type { CounterfactualAssessment } from "./counterfactualEngine";
import type { ResearchTrialLedgerSummary } from "./researchTrialLedger";
import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";

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

function regimeAwareEvaluation(overrides: Partial<RegimeAwareStrategyEvaluation> = {}): RegimeAwareStrategyEvaluation {
  return {
    schemaVersion: 1,
    datasetId: "dataset-a",
    contentSha256: "a".repeat(64),
    generatedAt: "2026-08-26T00:00:00.000Z",
    policy: { minimumWindowsPerRegime: 2 },
    slices: [],
    observedRegimeCount: 2,
    sufficientRegimeCount: 2,
    regimeRobustnessScore: 0.9,
    reasons: [],
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

function paperPerformance(overrides: Partial<PaperPerformanceSummary> = {}): PaperPerformanceSummary {
  return {
    startedAt: 1_000,
    endedAt: 2_000,
    observationDays: 30,
    tradeCount: 60,
    netReturn: 0.02,
    sharpeRatio: 1.1,
    profitFactor: 1.3,
    maximumDrawdown: 0.04,
    availabilityRatio: 0.995,
    unresolvedFaultCount: 0,
    killSwitchActivationCount: 0,
    executionQualityScore: 88,
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
    paperPerformance: paperPerformance(),
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
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { trialLedgerSummary: trialLedgerSummary({ failedCount: -1 }) })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { trialLedgerSummary: trialLedgerSummary({ failedCount: 1.5 }) })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { trialLedgerSummary: trialLedgerSummary({ completedCount: 5 }) })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { paperPerformance: paperPerformance({ netReturn: Number.NaN }) })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { paperPerformance: paperPerformance({ availabilityRatio: 1.4 }) })]), NusaLeagueError);
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", { paperPerformance: paperPerformance({ startedAt: 5_000, endedAt: 1_000 }) })]), NusaLeagueError);
  });

  it("QA: fails closed when a candidate's ghost execution status contradicts its own abstention decision", () => {
    // simulateGhostExecution only ever produces SIMULATED for a PROCEED_RESEARCH abstention and
    // SKIPPED for an ABSTAIN one. Two evidence objects on the same candidate disagreeing about
    // which one happened means at least one of them is not real evidence for this candidate.
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", {
      abstention: abstention({ decision: "ABSTAIN", netExpectedEdge: -0.001 }),
      ghostExecution: ghost({ status: "SIMULATED" }), // contradicts the ABSTAIN decision above
    })]), (error) => error instanceof NusaLeagueError && error.code === "GHOST_EXECUTION_ABSTENTION_MISMATCH");
    assert.throws(() => evaluateLeague([fullCandidate("candidate-a", {
      abstention: abstention({ decision: "PROCEED_RESEARCH" }),
      ghostExecution: ghost({ status: "SKIPPED", modeledEntryPrice: undefined, modeledExitPrice: undefined, grossReturn: undefined, totalCostRate: undefined, netReturn: undefined }), // contradicts PROCEED_RESEARCH
    })]), (error) => error instanceof NusaLeagueError && error.code === "GHOST_EXECUTION_ABSTENTION_MISMATCH");
    // A consistent pair on the same candidate must still be accepted.
    evaluateLeague([fullCandidate("candidate-a", {
      abstention: abstention({ decision: "PROCEED_RESEARCH" }),
      ghostExecution: ghost({ status: "SIMULATED" }),
    })]);
  });

  it("connects League to real PAPER evidence: confirms, diverges, and surfaces reliability risk without hiding it", () => {
    const confirmed = fullCandidate("candidate-confirmed", { paperPerformance: paperPerformance({ netReturn: 0.09 }) }); // benchmark.totalReturn defaults to 0.08
    const diverged = fullCandidate("candidate-diverged", { benchmark: benchmark({ id: "candidate-diverged" }), paperPerformance: paperPerformance({ netReturn: -0.02 }) });
    const unreliable = fullCandidate("candidate-unreliable", { benchmark: benchmark({ id: "candidate-unreliable" }), paperPerformance: paperPerformance({ unresolvedFaultCount: 2, killSwitchActivationCount: 1 }) });
    const noPaperEvidence = fullCandidate("candidate-no-paper", { benchmark: benchmark({ id: "candidate-no-paper" }), paperPerformance: undefined });

    const standing = evaluateLeague([confirmed, diverged, unreliable, noPaperEvidence]);
    const byId = (id: string) => standing.entries.find((entry) => entry.id === id)!;

    const confirmedEntry = byId("candidate-confirmed");
    assert.equal(confirmedEntry.components.paperNetReturn, 0.09);
    assert.ok(confirmedEntry.components.paperBacktestDivergence! < 0, "real PAPER outperforming the backtest is negative divergence");
    assert.equal(confirmedEntry.components.paperReliabilityPenalty, 0);
    assert.equal(confirmedEntry.reasons.includes("PAPER_PERFORMANCE_BELOW_BACKTEST"), false);

    const divergedEntry = byId("candidate-diverged");
    assert.ok(divergedEntry.reasons.includes("PAPER_PERFORMANCE_BELOW_BACKTEST"));
    assert.ok(divergedEntry.components.paperBacktestDivergence! > 0);

    const unreliableEntry = byId("candidate-unreliable");
    assert.ok(unreliableEntry.reasons.includes("PAPER_UNRESOLVED_FAULT"));
    assert.ok(unreliableEntry.reasons.includes("PAPER_KILL_SWITCH_ACTIVATED"));
    assert.equal(unreliableEntry.components.paperReliabilityPenalty, 1);
    assert.equal(unreliableEntry.eligible, true, "League surfaces the risk but does not itself hard-disqualify; that remains the production gate's job");

    const noPaperEntry = byId("candidate-no-paper");
    assert.equal(noPaperEntry.components.paperNetReturn, undefined);
    assert.ok(noPaperEntry.evidenceBreadth < confirmedEntry.evidenceBreadth);

    // Confirmed real performance must outrank a candidate whose real PAPER track record diverged
    // from the backtest or exposed unresolved reliability risk, all else equal.
    assert.ok(confirmedEntry.leagueScore! > divergedEntry.leagueScore!);
    assert.ok(confirmedEntry.leagueScore! > unreliableEntry.leagueScore!);
  });

  it("prefers real multi-regime OOS robustness evidence over the single current-market-state regime snapshot", () => {
    // regime.score (a snapshot of current market health) says 0.8; the candidate's own walk-forward
    // regime-bucketed OOS evidence says 0.2 (poor robustness once actually tested across regimes).
    // League must trust the stronger, candidate-specific evidence, not the generic market snapshot.
    const standing = evaluateLeague([fullCandidate("candidate-a", {
      regime: regime({ score: 0.8 }),
      regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: 0.2 }),
    })]);
    assert.equal(standing.entries[0]!.components.regimeRobustness, 0.2);
  });

  it("falls back to the regime snapshot when no regime-aware OOS evaluation is supplied", () => {
    const standing = evaluateLeague([fullCandidate("candidate-a", { regime: regime({ score: 0.8 }), regimeAwareEvaluation: undefined })]);
    assert.equal(standing.entries[0]!.components.regimeRobustness, 0.8);
  });

  it("surfaces narrow regime-robustness evidence instead of silently defaulting to neutral", () => {
    const standing = evaluateLeague([fullCandidate("candidate-a", {
      regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: undefined, sufficientRegimeCount: 0, reasons: ["INSUFFICIENT_ROBUSTNESS_EVIDENCE"] }),
    })]);
    assert.ok(standing.entries[0]!.reasons.includes("NARROW_REGIME_ROBUSTNESS_EVIDENCE"));
    assert.equal(standing.entries[0]!.components.regimeRobustness, undefined, "must not fall back to the snapshot when the deeper evidence was explicitly supplied but insufficient");
  });

  it("fails closed when regime-aware evaluation evidence does not actually describe this candidate", () => {
    assert.throws(
      () => evaluateLeague([fullCandidate("candidate-a", { regimeAwareEvaluation: regimeAwareEvaluation({ schemaVersion: 2 as 1 }) })]),
      (error) => error instanceof NusaLeagueError && error.code === "UNSUPPORTED_REGIME_AWARE_EVALUATION_SCHEMA",
    );
    assert.throws(
      () => evaluateLeague([fullCandidate("candidate-a", { regimeAwareEvaluation: regimeAwareEvaluation({ sourceDatasetIds: ["dataset-other"], datasetId: "dataset-a" }) })]),
      (error) => error instanceof NusaLeagueError && error.code === "REGIME_AWARE_EVALUATION_PROVENANCE_MISMATCH",
    );
    assert.throws(
      () => evaluateLeague([fullCandidate("candidate-a", { regimeAwareEvaluation: regimeAwareEvaluation({ datasetId: "dataset-other", sourceDatasetIds: ["dataset-a", "dataset-other"] }) })]),
      (error) => error instanceof NusaLeagueError && error.code === "REGIME_AWARE_EVALUATION_IDENTITY_MISMATCH",
    );
  });

  it("does not let a fragile single-regime edge outrank a genuinely robust one on headline return alone", () => {
    // The fragile candidate's backtest return is nearly four times the robust one's, but its edge
    // collapses outside one regime. Raw return must not buy the top rank.
    const standing = evaluateLeague([
      fullCandidate("fragile", {
        benchmark: benchmark({ id: "fragile", datasetId: "dataset-fragile", totalReturn: 0.30 }),
        regime: regime({ sourceDatasetIds: ["dataset-fragile"] }),
        regimeAwareEvaluation: regimeAwareEvaluation({ datasetId: "dataset-fragile", sourceDatasetIds: ["dataset-fragile"], regimeRobustnessScore: 0.05 }),
        abstention: abstention({ sourceDatasetIds: ["dataset-fragile"] }),
        ghostExecution: ghost({ sourceDatasetIds: ["dataset-fragile"] }),
        counterfactual: counterfactual({ sourceDatasetIds: ["dataset-fragile"] }),
      }),
      fullCandidate("robust", {
        benchmark: benchmark({ id: "robust", totalReturn: 0.08 }),
        regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: 0.95 }),
      }),
    ]);
    const fragile = standing.entries.find((entry) => entry.id === "fragile")!;
    const robust = standing.entries.find((entry) => entry.id === "robust")!;

    assert.equal(fragile.components.regimeRobustnessClass, "FRAGILE");
    assert.equal(robust.components.regimeRobustnessClass, "ROBUST");
    assert.ok(fragile.reasons.includes("REGIME_FRAGILE_EDGE"));
    assert.ok(robust.reasons.includes("REGIME_ROBUST_EDGE"));
    assert.equal(robust.rank, 1, "durable multi-regime evidence must outrank a bigger but fragile backtest return");
    assert.equal(fragile.rank, 2);
  });

  it("never shrinks a losing candidate's losses via the regime evidence discount", () => {
    // The discount exists to stop a fragile edge buying rank, never to flatter a bad candidate.
    const losing = { benchmark: benchmark({ id: "loser", totalReturn: -0.20 }), regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: 0.05 }) };
    const fragileLoss = evaluateLeague([fullCandidate("loser", losing)]).entries[0]!;
    const undiscountedLoss = evaluateLeague([fullCandidate("loser", { ...losing, regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: 0.95 }) })]).entries[0]!;
    // Same negative return contribution in both: the fragile one must not score *higher*.
    assert.ok(fragileLoss.leagueScore! <= undiscountedLoss.leagueScore!);
  });

  it("surfaces insufficient regime coverage explicitly instead of scoring it as robust", () => {
    const standing = evaluateLeague([fullCandidate("candidate-a", {
      regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: undefined, sufficientRegimeCount: 0 }),
    })]);
    const entry = standing.entries[0]!;
    assert.equal(entry.components.regimeRobustnessClass, "INSUFFICIENT");
    assert.ok(entry.reasons.includes("INSUFFICIENT_REGIME_COVERAGE"));
    assert.equal(entry.reasons.includes("REGIME_ROBUST_EDGE"), false);
    assert.ok(entry.components.regimeEvidenceDiscount! < 1, "unproven regime coverage must not receive full backtest credit");
  });

  it("treats a single sufficiently-evidenced regime as INSUFFICIENT, never ROBUST", () => {
    // One regime holding up says nothing about durability across regimes.
    const standing = evaluateLeague([fullCandidate("candidate-a", {
      regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: 0.99, sufficientRegimeCount: 1 }),
    })]);
    assert.equal(standing.entries[0]!.components.regimeRobustnessClass, "INSUFFICIENT");
  });

  it("does not classify regime robustness at all from the current-market-state snapshot alone", () => {
    // The snapshot describes the market right now, not this candidate's durability -- it must
    // never be laundered into a ROBUST classification.
    const standing = evaluateLeague([fullCandidate("candidate-a", { regime: regime({ score: 0.99 }), regimeAwareEvaluation: undefined })]);
    const entry = standing.entries[0]!;
    assert.equal(entry.components.regimeRobustnessClass, undefined);
    assert.equal(entry.components.regimeEvidenceDiscount, undefined);
    assert.equal(entry.leagueScore, evaluateLeague([fullCandidate("candidate-a", { regime: regime({ score: 0.99 }), regimeAwareEvaluation: undefined })]).entries[0]!.leagueScore);
  });

  it("fails closed on an incoherent regime evidence policy instead of silently clamping it", () => {
    for (const bad of [
      { regimeRobustnessThreshold: 1.5 },
      { fragileEvidenceDiscount: -0.1 },
      { insufficientRegimeEvidenceDiscount: Number.NaN },
      // A fragile edge must never be credited more generously than a merely under-evidenced one.
      { fragileEvidenceDiscount: 0.9, insufficientRegimeEvidenceDiscount: 0.2 },
    ]) {
      assert.throws(
        () => evaluateLeague([fullCandidate("candidate-a")], { policy: { probabilityBacktestOverfittingPenaltyWeight: 200, ...bad } }),
        (error) => error instanceof NusaLeagueError && error.code === "INVALID_POLICY",
        JSON.stringify(bad),
      );
    }
  });

  it("keeps regime classification deterministic and independent of candidate input order", () => {
    const build = () => [
      fullCandidate("candidate-a", { regimeAwareEvaluation: regimeAwareEvaluation({ regimeRobustnessScore: 0.95 }) }),
      fullCandidate("candidate-b", { benchmark: benchmark({ id: "candidate-b", datasetId: "dataset-b" }), regime: regime({ sourceDatasetIds: ["dataset-b"] }), abstention: abstention({ sourceDatasetIds: ["dataset-b"] }), ghostExecution: ghost({ sourceDatasetIds: ["dataset-b"] }), counterfactual: counterfactual({ sourceDatasetIds: ["dataset-b"] }), regimeAwareEvaluation: regimeAwareEvaluation({ datasetId: "dataset-b", sourceDatasetIds: ["dataset-b"], regimeRobustnessScore: 0.95 }) }),
    ];
    const forward = evaluateLeague(build());
    const reversed = evaluateLeague([...build()].reverse());
    assert.deepEqual(
      forward.entries.map((entry) => [entry.id, entry.rank, entry.leagueScore, entry.components.regimeRobustnessClass]),
      reversed.entries.map((entry) => [entry.id, entry.rank, entry.leagueScore, entry.components.regimeRobustnessClass]),
    );
  });

  it("never produces an order, broker call, or LIVE/capital-allocation authority", () => {
    const standing = evaluateLeague([fullCandidate("candidate-a")]);
    const serialized = JSON.stringify(standing).toLowerCase();
    for (const forbidden of ["liveauthority", "productionmutationallowed", "order", "broker", "withdraw", "transfer", "activationlease"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});
