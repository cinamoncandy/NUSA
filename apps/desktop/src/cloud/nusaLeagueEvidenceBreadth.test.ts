import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adviseLeagueCapitalAllocation, LeagueCapitalAllocationError } from "./leagueCapitalAllocation";
import { evaluateLeague, type LeagueCandidateInput } from "./nusaLeague";
import type { ResearchBenchmarkSliceScore } from "./researchBenchmarkScorecard";
import type { RegimeAwareStrategyEvaluation } from "./regimeAwareStrategyEvaluation";

const benchmark = (): ResearchBenchmarkSliceScore => ({
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
});

const regimeAware = (sufficient: boolean): RegimeAwareStrategyEvaluation => ({
  schemaVersion: 1,
  datasetId: "dataset-a",
  contentSha256: "a".repeat(64),
  generatedAt: "2026-08-26T00:00:00.000Z",
  policy: { minimumWindowsPerRegime: 2 },
  slices: [],
  observedRegimeCount: sufficient ? 2 : 1,
  sufficientRegimeCount: sufficient ? 2 : 1,
  ...(sufficient ? { regimeRobustnessScore: 0.8 } : {}),
  reasons: sufficient ? [] : ["INSUFFICIENT_REGIME_DIVERSITY", "INSUFFICIENT_ROBUSTNESS_EVIDENCE"],
  sourceDatasetIds: ["dataset-a"],
});

const candidate = (sufficient: boolean): LeagueCandidateInput => ({
  id: "candidate-a",
  familyId: "family-a",
  benchmark: benchmark(),
  deflatedSharpe: {
    searchId: "search-a",
    selectedTrialId: "candidate-a",
    observedSharpe: 1.2,
    searchTrialCount: 5,
    completedSharpeTrialCount: 5,
    trialSharpeStdDev: 0.2,
    expectedMaximumSharpe: 0.6,
    zScore: 2.1,
    deflatedSharpeProbability: 0.97,
    confidenceThreshold: 0.95,
    passes: true,
  },
  regime: {
    schemaVersion: 1,
    asOf: 1_000,
    state: "HEALTHY",
    score: 0.8,
    components: { breadth: 0.7, medianReturn: 0.02, medianDrawdown: -0.05, medianVolatility: 0.01, dispersion: 0.02 },
    reasons: [],
    sourceDatasetIds: ["dataset-a"],
  },
  abstention: {
    schemaVersion: 1,
    asOf: 1_000,
    decision: "PROCEED_RESEARCH",
    netExpectedEdge: 0.01,
    effectiveMinimumConfidence: 0.6,
    reasons: [],
    sourceDatasetIds: ["dataset-a"],
  },
  regimeAwareEvaluation: regimeAware(sufficient),
});

describe("League evidence breadth sufficiency", () => {
  it("does not let insufficient regime evidence unlock the allocation breadth gate", () => {
    const standing = evaluateLeague([candidate(false)]);
    const entry = standing.entries[0]!;

    assert.equal(entry.components.regimeRobustnessClass, "INSUFFICIENT");
    assert.equal(entry.evidenceBreadth, 3 / 8);
    assert.ok(entry.reasons.includes("INSUFFICIENT_REGIME_COVERAGE"));
    assert.throws(
      () => adviseLeagueCapitalAllocation(standing, { minimumEvidenceBreadth: 0.5 }),
      (error: unknown) => error instanceof LeagueCapitalAllocationError && error.code === "NO_ALLOCATABLE_CANDIDATES",
    );
  });

  it("counts regime-aware evidence once it has sufficient cross-regime support", () => {
    const standing = evaluateLeague([candidate(true)]);
    const entry = standing.entries[0]!;

    assert.equal(entry.components.regimeRobustnessClass, "ROBUST");
    assert.equal(entry.evidenceBreadth, 4 / 8);
  });
});
