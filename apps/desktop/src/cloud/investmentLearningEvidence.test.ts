import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendResearchTrial, type ResearchTrialRecord, type ResearchTrialOutcome } from "./researchTrialLedger";
import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";
import { buildInvestmentLearningEvidence, buildInvestmentResearchAttentionPlan, orderResearchFamiliesByLearning } from "./investmentLearningEvidence";

const HASH = "a".repeat(64);
function ledgerOf(...rows: readonly (readonly [string, ResearchTrialOutcome, string?])[]): readonly ResearchTrialRecord[] {
  let ledger: readonly ResearchTrialRecord[] = [];
  rows.forEach(([familyId, outcome, searchId], index) => {
    const resolvedSearchId = searchId ?? `search-${index + 1}`;
    ledger = appendResearchTrial(ledger, {
      trialId: `trial-${index + 1}`,
      familyId,
      hypothesis: `hypothesis-${index + 1}`,
      createdAt: new Date(index * 1_000).toISOString(),
      dataset: { datasetId: "dataset-a", contentSha256: HASH, market: "KRW-BTC", interval: "1d" },
      candidateIds: [`candidate-${index + 1}`],
      search: { searchId: resolvedSearchId, attemptOrdinal: ledger.filter((record) => record.search.searchId === resolvedSearchId).length + 1 },
      outcome,
      ...(outcome === "REJECTED" ? { rejectionReasons: ["gate"] } : {}),
      ...(outcome === "ABSTAINED" ? { abstentionReasons: ["risk"] } : {}),
    });
  });
  return ledger;
}

function entry(id: string, familyId: string, overrides: Partial<LeagueRankedEntry["components"]> = {}): LeagueRankedEntry {
  return {
    id, familyId, eligible: false, outcome: "REJECTED", reasons: ["evidence"], evidenceBreadth: 1,
    components: {
      outOfSamplePerformance: 0.01, benchmarkExcess: -0.01, maximumDrawdown: 0.05,
      regimeRobustnessClass: "FRAGILE", paperReliabilityPenalty: 0,
      ...overrides,
    },
    sourceDatasetIds: ["dataset-a"],
  };
}
function standing(entries: readonly LeagueRankedEntry[]): LeagueStanding {
  const families = new Set(entries.map((item) => item.familyId));
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-10T00:00:00.000Z",
    policy: { probabilityBacktestOverfittingPenaltyWeight: 200, regimeRobustnessThreshold: 0.5, fragileEvidenceDiscount: 0.25, insufficientRegimeEvidenceDiscount: 0.5 },
    entries,
    coverage: { candidateCount: entries.length, eligibleCount: entries.filter((item) => item.eligible).length, familyCount: families.size },
    provenance: { sourceDatasetIds: ["dataset-a"] },
  };
}

describe("bounded investment learning evidence", () => {
  it("keeps rejected and abstained trials in the learning denominator", () => {
    const ledger = ledgerOf(["trend", "COMPLETED"], ["trend", "REJECTED"], ["trend", "ABSTAINED"], ["trend", "REJECTED"], ["trend", "ABSTAINED"]);
    const family = buildInvestmentLearningEvidence({ ledger, standing: standing([entry("a", "trend"), entry("b", "trend")]) }).families[0]!;
    assert.equal(family.priorTrialCount, 5);
    assert.equal(family.historicalFailureRatio, 0.8);
    assert.ok(family.boundedPriorAdjustment < 0);
    assert.equal(family.priorDistinctSearchCount, 5);
    assert.ok(family.recurringHistoricalFailureReasons.includes("gate"));
    assert.ok(family.recurringHistoricalFailureReasons.includes("risk"));
    assert.equal(family.guidance, "DEPRIORITIZE");
  });

  it("does not learn nine times from one nine-cell canonical search", () => {
    const ledger = ledgerOf(...Array.from({ length: 9 }, () => ["trend", "REJECTED", "one-grid"] as const));
    const family = buildInvestmentLearningEvidence({
      ledger,
      standing: standing([entry("a", "trend"), entry("b", "trend")]),
    }).families[0]!;
    assert.equal(family.priorTrialCount, 9);
    assert.equal(family.priorDistinctSearchCount, 1);
    assert.equal(family.boundedPriorAdjustment, 0);
    assert.equal(family.guidance, "EXPLORE");
  });

  it("prevents the current trial from influencing guidance applied to itself", () => {
    const ledger = ledgerOf(["trend", "FAILED"], ["trend", "FAILED"], ["trend", "FAILED"], ["trend", "FAILED"], ["trend", "FAILED"], ["trend", "COMPLETED"]);
    const before = buildInvestmentLearningEvidence({ ledger, standing: standing([entry("a", "trend")]), evaluatedSequence: 6 });
    const after = buildInvestmentLearningEvidence({ ledger, standing: standing([entry("a", "trend")]), evaluatedSequence: 7 });
    assert.equal(before.families[0]!.priorTrialCount, 5);
    assert.equal(after.families[0]!.priorTrialCount, 6);
    assert.notEqual(before.evidenceFingerprintSha256, after.evidenceFingerprintSha256);
  });

  it("never turns positive history into automatic promotion authority", () => {
    const ledger = ledgerOf(...Array.from({ length: 6 }, () => ["trend", "COMPLETED"] as const));
    const result = buildInvestmentLearningEvidence({ ledger, standing: standing([entry("a", "trend", { benchmarkExcess: 0.02, regimeRobustnessClass: "ROBUST" })]) });
    assert.equal(result.families[0]!.guidance, "HOLD");
    assert.equal(result.authority.qualificationMutationAllowed, false);
    assert.equal(result.authority.scoreMutationAllowed, false);
    assert.equal(result.authority.executionAuthority, "NONE");
    assert.equal(result.authority.liveAuthority, "NONE");
  });

  it("routes under-explored families earlier without removing declared families", () => {
    const ledger = ledgerOf(...Array.from({ length: 6 }, () => ["trend", "COMPLETED"] as const), ["mean", "FAILED"]);
    const evidence = buildInvestmentLearningEvidence({
      ledger,
      standing: standing([entry("a", "trend")]),
      declaredFamilyIds: ["trend", "mean"],
    });
    assert.equal(evidence.families.find((item) => item.familyId === "mean")?.guidance, "EXPLORE");
    assert.deepEqual(orderResearchFamiliesByLearning(["trend", "mean"], evidence), ["mean", "trend"]);
  });

  it("reports current failure mechanisms and missing attribution evidence", () => {
    const ledger = ledgerOf(...Array.from({ length: 5 }, () => ["trend", "FAILED"] as const));
    const family = buildInvestmentLearningEvidence({ ledger, standing: standing([
      entry("a", "trend", { paperReliabilityPenalty: undefined }),
      entry("b", "trend", { paperReliabilityPenalty: undefined }),
    ]) }).families[0]!;
    assert.ok(family.currentFailureCategories.includes("SIGNAL_FAILURE"));
    assert.ok(family.currentFailureCategories.includes("REGIME_ERROR"));
    assert.ok(family.insufficientEvidenceFor.includes("CALIBRATION_ERROR"));
    assert.ok(family.insufficientEvidenceFor.includes("INFRASTRUCTURE_FAILURE"));
    assert.ok(family.recurringFailureCategories.includes("SIGNAL_FAILURE"));
    assert.equal(family.failureCategoryCounts.SIGNAL_FAILURE, 2);
  });

  it("does not deprioritize a family from one isolated current candidate failure", () => {
    const ledger = ledgerOf(...Array.from({ length: 5 }, () => ["trend", "FAILED"] as const));
    const family = buildInvestmentLearningEvidence({ ledger, standing: standing([entry("a", "trend")]) }).families[0]!;
    assert.equal(family.boundedPriorAdjustment < 0, true);
    assert.deepEqual(family.recurringFailureCategories, []);
    assert.equal(family.guidance, "HOLD");
  });

  it("balances research attention toward families with fewer distinct searches", () => {
    const ledger = ledgerOf(
      ["trend", "COMPLETED", "trend-1"], ["trend", "COMPLETED", "trend-2"],
      ["mean", "COMPLETED", "mean-1"],
    );
    const evidence = buildInvestmentLearningEvidence({
      ledger,
      standing: standing([]),
      declaredFamilyIds: ["trend", "mean"],
      feedbackPolicy: { minimumPriorTrials: 1 },
    });
    assert.deepEqual(orderResearchFamiliesByLearning(["trend", "mean"], evidence), ["mean", "trend"]);
  });

  it("builds an explicit advisory Strategy Research queue without inventing families", () => {
    const evidence = buildInvestmentLearningEvidence({
      ledger: ledgerOf(["trend", "FAILED"], ["mean", "FAILED"]),
      standing: standing([]),
      declaredFamilyIds: ["trend", "mean"],
    });
    const plan = buildInvestmentResearchAttentionPlan(["trend", "mean"], evidence);
    assert.deepEqual(plan.map((item) => item.rank), [1, 2]);
    assert.deepEqual(new Set(plan.map((item) => item.familyId)), new Set(["trend", "mean"]));
    assert.ok(plan.every((item) => item.priorDistinctSearchCount >= 0));
  });

  it("attaches PAPER Review research focus without changing family order", () => {
    const evidence = buildInvestmentLearningEvidence({
      ledger: ledgerOf(["trend", "FAILED"], ["mean", "FAILED"]),
      standing: standing([]),
      declaredFamilyIds: ["trend", "mean"],
    });
    const baseline = buildInvestmentResearchAttentionPlan(["trend", "mean"], evidence);
    const withReview = buildInvestmentResearchAttentionPlan(["trend", "mean"], evidence, [{
      feedbackId: "review-1",
      candidateId: "candidate-review",
      strategyFamilyId: "trend",
      regime: "TREND_UP",
      actions: ["PRIORITIZE_COST_ROBUSTNESS", "PRIORITIZE_DRAWDOWN_CONTROL"],
      reasons: ["COST_EROSION", "DRAWDOWN_DETERIORATION"],
      researchPriorityMutationAllowed: false,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }]);
    assert.deepEqual(withReview.map((item) => item.familyId), baseline.map((item) => item.familyId));
    assert.deepEqual(
      withReview.find((item) => item.familyId === "trend")?.reviewResearchFocusActions,
      ["PRIORITIZE_COST_ROBUSTNESS", "PRIORITIZE_DRAWDOWN_CONTROL"],
    );
    assert.deepEqual(withReview.find((item) => item.familyId === "mean")?.reviewResearchFocusActions, []);
  });

  it("fails closed on Review feedback that tries to gain mutation authority or inject a family", () => {
    const evidence = buildInvestmentLearningEvidence({
      ledger: ledgerOf(["trend", "FAILED"]),
      standing: standing([]),
      declaredFamilyIds: ["trend"],
    });
    const base = {
      feedbackId: "review-1", candidateId: "candidate-review", strategyFamilyId: "trend", regime: "TREND_UP",
      actions: ["PRIORITIZE_REGIME_ROBUSTNESS"] as const, reasons: ["REGIME_DEGRADATION"],
      researchPriorityMutationAllowed: false as const, liveAuthority: "NONE" as const,
      productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const,
    };
    assert.throws(() => buildInvestmentResearchAttentionPlan(["trend"], evidence, [{ ...base, researchPriorityMutationAllowed: true } as never]));
    assert.throws(() => buildInvestmentResearchAttentionPlan(["trend"], evidence, [{ ...base, strategyFamilyId: "injected" }]));
  });

  it("is deterministic under League entry permutation", () => {
    const ledger = ledgerOf(["trend", "FAILED"], ["mean", "FAILED"]);
    const a = buildInvestmentLearningEvidence({ ledger, standing: standing([entry("a", "trend"), entry("b", "mean")]) });
    const b = buildInvestmentLearningEvidence({ ledger, standing: standing([entry("b", "mean"), entry("a", "trend")]) });
    assert.equal(a.evidenceFingerprintSha256, b.evidenceFingerprintSha256);
    assert.deepEqual(a.families, b.families);
  });

  it("fails closed on tampered sealed history", () => {
    const ledger = ledgerOf(["trend", "FAILED"]);
    const tampered = [{ ...ledger[0]!, familyId: "mean" }];
    assert.throws(() => buildInvestmentLearningEvidence({ ledger: tampered, standing: standing([entry("a", "trend")]) }));
  });

  it("fails closed on malformed League coverage and missing family guidance", () => {
    const ledger = ledgerOf(["trend", "FAILED"]);
    const base = standing([entry("a", "trend")]);
    assert.throws(() => buildInvestmentLearningEvidence({ ledger, standing: { ...base, coverage: { ...base.coverage, candidateCount: 99 } } }));
    const evidence = buildInvestmentLearningEvidence({ ledger, standing: base });
    assert.throws(() => orderResearchFamiliesByLearning(["trend", "unknown"], evidence));
  });
});
