import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessPromotionEvidence, PromotionEvidenceError } from "./promotionEvidenceAdvisory";
import type { LeagueCandidateComponents, LeagueRankedEntry, LeagueStanding } from "./nusaLeague";
import type { PboCscvEvidence } from "./researchSearchAdjustedEvidence";

/** Components satisfying all six evidence pillars at once. */
function strongComponents(overrides: Partial<LeagueCandidateComponents> = {}): LeagueCandidateComponents {
  return {
    outOfSamplePerformance: 0.08,
    benchmarkExcess: 0.03,
    maximumDrawdown: 0.05,
    riskAdjusted: 0.97,
    regimeRobustness: 0.9,
    regimeRobustnessClass: "ROBUST",
    regimeEvidenceDiscount: 1,
    costAdjustedGhostReturn: 0.018,
    abstentionQuality: 0.8,
    counterfactualRegret: 0,
    trialFailureRatio: 0.4,
    paperNetReturn: 0.09,
    paperBacktestDivergence: -0.01,
    paperReliabilityPenalty: 0,
    ...overrides,
  };
}

function entry(id: string, overrides: Partial<LeagueRankedEntry> = {}): LeagueRankedEntry {
  return {
    id,
    familyId: "family-1",
    eligible: true,
    reasons: [],
    evidenceBreadth: 1,
    components: strongComponents(),
    leagueScore: 120,
    rank: 1,
    sourceDatasetIds: [`dataset-${id}`],
    ...overrides,
  };
}

function standing(entries: readonly LeagueRankedEntry[]): LeagueStanding {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-26T05:00:00.000Z",
    policy: {
      probabilityBacktestOverfittingPenaltyWeight: 200,
      regimeRobustnessThreshold: 0.5,
      fragileEvidenceDiscount: 0.25,
      insufficientRegimeEvidenceDiscount: 0.5,
    },
    entries,
    coverage: {
      candidateCount: entries.length,
      eligibleCount: entries.filter((item) => item.eligible).length,
      familyCount: new Set(entries.map((item) => item.familyId)).size,
    },
    provenance: { sourceDatasetIds: [...new Set(entries.flatMap((item) => item.sourceDatasetIds))].sort() },
  };
}

function pbo(probability: number): PboCscvEvidence {
  return {
    strategyCount: 3,
    observationCount: 32,
    partitions: 8,
    splitCount: 70,
    overfitSplitCount: Math.round(probability * 70),
    probabilityBacktestOverfitting: probability,
    medianLogit: 0.4,
    splits: [],
  };
}

describe("assessPromotionEvidence", () => {
  it("grades a fully-evidenced candidate ROBUST and names every satisfied pillar", () => {
    const advisory = assessPromotionEvidence(standing([entry("a")]), { probabilityBacktestOverfitting: pbo(0.1) });
    const assessment = advisory.assessments[0]!;

    assert.equal(assessment.strength, "ROBUST");
    assert.deepEqual(assessment.blockers, []);
    assert.deepEqual(assessment.satisfiedPillars, [
      "COST_ADJUSTED_EXECUTION",
      "DEFLATED_SHARPE",
      "NO_COUNTERFACTUAL_REGRET",
      "OOS_BENCHMARK_EXCESS",
      "PAPER_FORWARD_CONFIRMS_BACKTEST",
      "REGIME_ROBUSTNESS",
    ]);
    assert.equal(advisory.promotableCandidateCount, 1);
  });

  it("pins strength at INSUFFICIENT on any hard blocker, however strong the rest of the evidence is", () => {
    // Each case keeps every other pillar perfect, so only the blocker can be responsible.
    const cases: readonly (readonly [string, LeagueRankedEntry])[] = [
      ["LEAGUE_INELIGIBLE", entry("a", { eligible: false })],
      ["NO_LEAGUE_SCORE", entry("a", { leagueScore: undefined })],
      ["REGIME_FRAGILE_EDGE", entry("a", { components: strongComponents({ regimeRobustnessClass: "FRAGILE" }) })],
      ["PAPER_RELIABILITY_RISK", entry("a", { components: strongComponents({ paperReliabilityPenalty: 0.4 }) })],
      ["MISSING_PROVENANCE", entry("a", { sourceDatasetIds: [] })],
    ];
    for (const [expectedBlocker, candidate] of cases) {
      const assessment = assessPromotionEvidence(standing([candidate]), { probabilityBacktestOverfitting: pbo(0.1) }).assessments[0]!;
      assert.equal(assessment.strength, "INSUFFICIENT", expectedBlocker);
      assert.ok(assessment.blockers.includes(expectedBlocker), expectedBlocker);
    }
  });

  it("blocks the whole field when search-level overfitting probability is too high", () => {
    const advisory = assessPromotionEvidence(standing([entry("a"), entry("b")]), { probabilityBacktestOverfitting: pbo(0.9) });
    for (const assessment of advisory.assessments) {
      assert.equal(assessment.strength, "INSUFFICIENT");
      assert.ok(assessment.blockers.includes("PROBABILITY_BACKTEST_OVERFITTING_TOO_HIGH"));
    }
    assert.equal(advisory.promotableCandidateCount, 0);
    assert.ok(advisory.reasons.includes("NO_CANDIDATE_HAS_SUFFICIENT_EVIDENCE"));
  });

  it("never lets strong returns substitute for missing evidence categories", () => {
    // Enormous OOS return, but nothing else is evidenced at all.
    const thin = entry("a", {
      evidenceBreadth: 0.2,
      components: {
        outOfSamplePerformance: 0.9,
        benchmarkExcess: 0.8,
        maximumDrawdown: 0.01,
      },
    });
    const assessment = assessPromotionEvidence(standing([thin])).assessments[0]!;
    assert.equal(assessment.strength, "NARROW", "breadth is a floor: a huge return cannot buy strength");
    assert.ok(assessment.gaps.includes("NO_REGIME_EVALUATION"));
    assert.ok(assessment.gaps.includes("NO_PAPER_FORWARD_EVIDENCE"));
    assert.ok(assessment.gaps.includes("NO_DEFLATED_SHARPE_EVIDENCE"));
  });

  it("does not count INSUFFICIENT regime coverage as regime robustness", () => {
    const assessment = assessPromotionEvidence(
      standing([entry("a", { components: strongComponents({ regimeRobustnessClass: "INSUFFICIENT" }) })]),
      { probabilityBacktestOverfitting: pbo(0.1) },
    ).assessments[0]!;
    assert.equal(assessment.satisfiedPillars.includes("REGIME_ROBUSTNESS"), false);
    assert.ok(assessment.gaps.includes("INSUFFICIENT_REGIME_COVERAGE"));
    assert.notEqual(assessment.strength, "ROBUST");
  });

  it("treats PAPER forward evidence that diverges below the backtest as unconfirmed, not confirming", () => {
    const assessment = assessPromotionEvidence(
      standing([entry("a", { components: strongComponents({ paperNetReturn: 0.01, paperBacktestDivergence: 0.07 }) })]),
      { probabilityBacktestOverfitting: pbo(0.1) },
    ).assessments[0]!;
    assert.ok(assessment.gaps.includes("PAPER_FORWARD_DOES_NOT_CONFIRM_BACKTEST"));
    assert.equal(assessment.satisfiedPillars.includes("PAPER_FORWARD_CONFIRMS_BACKTEST"), false);
    assert.notEqual(assessment.strength, "ROBUST");
  });

  it("reports SUPPORTIVE without promoting it to ROBUST", () => {
    // Four pillars satisfied: OOS excess, DSR, regime robustness, cost-adjusted execution.
    const assessment = assessPromotionEvidence(
      standing([entry("a", { components: strongComponents({ counterfactualRegret: 0.02, paperNetReturn: undefined, paperBacktestDivergence: undefined }) })]),
      { probabilityBacktestOverfitting: pbo(0.1) },
    ).assessments[0]!;
    assert.equal(assessment.strength, "SUPPORTIVE");
    assert.equal(assessPromotionEvidence(standing([entry("a", { components: strongComponents({ counterfactualRegret: 0.02, paperNetReturn: undefined, paperBacktestDivergence: undefined }) })]), { probabilityBacktestOverfitting: pbo(0.1) }).promotableCandidateCount, 0, "SUPPORTIVE is explicitly not promotable");
  });

  it("discloses when no search-overfitting evidence was supplied instead of assuming none exists", () => {
    const advisory = assessPromotionEvidence(standing([entry("a")]));
    assert.ok(advisory.reasons.includes("NO_SEARCH_OVERFITTING_EVIDENCE_SUPPLIED"));
  });

  it("fails closed on unsupported schema, invalid policy, and invalid PBO evidence", () => {
    assert.throws(
      () => assessPromotionEvidence({ ...standing([entry("a")]), schemaVersion: 2 as 1 }),
      (error) => error instanceof PromotionEvidenceError && error.code === "UNSUPPORTED_LEAGUE_SCHEMA",
    );
    for (const bad of [
      { minimumEvidenceBreadth: 1.4 },
      { minimumDeflatedSharpeProbability: -0.1 },
      { maximumProbabilityBacktestOverfitting: Number.NaN },
      { minimumPaperObservationDays: -1 },
      { minimumPaperTradeCount: Number.POSITIVE_INFINITY },
    ]) {
      assert.throws(
        () => assessPromotionEvidence(standing([entry("a")]), { policy: bad }),
        (error) => error instanceof PromotionEvidenceError && error.code === "INVALID_POLICY",
        JSON.stringify(bad),
      );
    }
    assert.throws(
      () => assessPromotionEvidence(standing([entry("a")]), { probabilityBacktestOverfitting: pbo(1.4) }),
      (error) => error instanceof PromotionEvidenceError && error.code === "INVALID_PBO_EVIDENCE",
    );
  });

  it("is deterministic and independent of candidate order", () => {
    const build = () => [entry("a"), entry("b", { components: strongComponents({ counterfactualRegret: 0.05 }) })];
    const forward = assessPromotionEvidence(standing(build()), { probabilityBacktestOverfitting: pbo(0.1) });
    const reversed = assessPromotionEvidence(standing([...build()].reverse()), { probabilityBacktestOverfitting: pbo(0.1) });
    const key = (advisory: typeof forward) => advisory.assessments
      .map((assessment) => [assessment.candidateId, assessment.strength, assessment.satisfiedPillars.join("|")])
      .sort((left, right) => left[0]!.localeCompare(right[0]!));
    assert.deepEqual(key(forward), key(reversed));
    assert.equal(forward.promotableCandidateCount, reversed.promotableCandidateCount);
  });

  it("never emits an order, broker call, capital amount, or LIVE authority", () => {
    const advisory = assessPromotionEvidence(standing([entry("a")]), { probabilityBacktestOverfitting: pbo(0.1) });
    const serialized = JSON.stringify(advisory).toLowerCase();
    for (const forbidden of ["liveauthority", "productionmutationallowed", "order", "broker", "withdraw", "transfer", "notional", "capitalamount", "activationlease"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.ok(advisory.reasons.includes("RESEARCH_ADVISORY_ONLY"));
    assert.ok(advisory.reasons.includes("NO_PROMOTION_AUTHORITY"));
  });
});
