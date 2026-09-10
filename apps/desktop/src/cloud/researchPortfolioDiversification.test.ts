import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";
import {
  adviseCorrelationAwareLeagueCapitalAllocation,
  buildResearchPortfolioDiversificationEvidence,
  ResearchPortfolioDiversificationError,
  type ResearchPortfolioDiversificationSeries,
} from "./researchPortfolioDiversification";

const hash = (letter: string): string => letter.repeat(64);
const timestamps = Array.from({ length: 10 }, (_, index) => 1_000 + index);

function series(candidateId: string, familyId: string, values: readonly number[], overrides: Partial<ResearchPortfolioDiversificationSeries> = {}): ResearchPortfolioDiversificationSeries {
  return {
    candidateId,
    familyId,
    datasetId: `dataset-${candidateId}`,
    datasetContentSha256: hash(candidateId.slice(0, 1).replace(/[^a-f0-9]/i, "a").toLowerCase() || "a"),
    market: "KRW-BTC",
    interval: "1d",
    returns: values.map((value, index) => ({ timestamp: timestamps[index]!, value })),
    ...overrides,
  };
}

function entry(id: string, familyId: string, rank: number, score: number): LeagueRankedEntry {
  return {
    id,
    familyId,
    eligible: true,
    outcome: "QUALIFIED_FOR_LEAGUE",
    reasons: [],
    evidenceBreadth: 1,
    components: { outOfSamplePerformance: 0.05, benchmarkExcess: 0.02, maximumDrawdown: 0.04 },
    leagueScore: score,
    rank,
    sourceDatasetIds: [`dataset-${id}`],
  };
}

function standing(entries: readonly LeagueRankedEntry[]): LeagueStanding {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-10T00:00:00.000Z",
    policy: {
      probabilityBacktestOverfittingPenaltyWeight: 200,
      regimeRobustnessThreshold: 0.5,
      fragileEvidenceDiscount: 0.25,
      insufficientRegimeEvidenceDiscount: 0.5,
    },
    entries,
    coverage: {
      candidateCount: entries.length,
      eligibleCount: entries.filter((candidate) => candidate.eligible).length,
      familyCount: new Set(entries.map((candidate) => candidate.familyId)).size,
    },
    provenance: { sourceDatasetIds: [...new Set(entries.flatMap((candidate) => candidate.sourceDatasetIds))].sort() },
  };
}

const a = [0.02, -0.01, 0.03, -0.02, 0.01, 0.04, -0.03, 0.02, -0.01, 0.03];
const sameDirection = a.map((value) => value * 2);
const oppositeDirection = a.map((value) => -value);
const lowDependence = [0.01, 0.03, -0.02, -0.01, 0.04, -0.02, 0.01, -0.03, 0.03, 0.00];

describe("Research portfolio diversification evidence", () => {
  it("measures positive and negative dependence using absolute correlation", () => {
    const evidence = buildResearchPortfolioDiversificationEvidence([
      series("a", "trend", a),
      series("b", "breakout", sameDirection),
      series("c", "mean-reversion", oppositeDirection),
    ]);
    const ab = evidence.pairs.find((pair) => pair.leftCandidateId === "a" && pair.rightCandidateId === "b")!;
    const ac = evidence.pairs.find((pair) => pair.leftCandidateId === "a" && pair.rightCandidateId === "c")!;
    assert.ok(Math.abs(ab.correlation - 1) < 1e-12);
    assert.ok(Math.abs(ac.correlation + 1) < 1e-12);
    assert.equal(ab.absoluteCorrelation, 1);
    assert.equal(ac.absoluteCorrelation, 1);
    assert.equal(evidence.maximumAbsolutePairwiseCorrelation, 1);
  });

  it("computes simultaneous drawdown overlap from point-in-time OOS equity paths", () => {
    const evidence = buildResearchPortfolioDiversificationEvidence([
      series("a", "trend", a),
      series("b", "breakout", sameDirection),
    ]);
    assert.ok(evidence.pairs[0]!.simultaneousDrawdownOverlap > 0);
    assert.equal(evidence.maximumSimultaneousDrawdownOverlap, evidence.pairs[0]!.simultaneousDrawdownOverlap);
  });

  it("fails closed for misaligned timestamps and zero-variance series", () => {
    assert.throws(
      () => buildResearchPortfolioDiversificationEvidence([
        series("a", "trend", a),
        series("b", "breakout", sameDirection, { returns: sameDirection.map((value, index) => ({ timestamp: timestamps[index]! + (index >= 5 ? 1 : 0), value })) }),
      ]),
      (error) => error instanceof ResearchPortfolioDiversificationError && error.code === "OOS_TIMESTAMP_ALIGNMENT_MISMATCH",
    );
    assert.throws(
      () => buildResearchPortfolioDiversificationEvidence([series("a", "trend", a), series("z", "flat", Array(10).fill(0))]),
      (error) => error instanceof ResearchPortfolioDiversificationError && error.code === "ZERO_RETURN_VARIANCE",
    );
  });

  it("is deterministic under candidate input permutation", () => {
    const forward = buildResearchPortfolioDiversificationEvidence([series("a", "trend", a), series("b", "breakout", sameDirection), series("d", "other", lowDependence)]);
    const reversed = buildResearchPortfolioDiversificationEvidence([series("d", "other", lowDependence), series("b", "breakout", sameDirection), series("a", "trend", a)]);
    assert.deepEqual(forward, reversed);
  });

  it("excludes the lower-ranked member of a verified over-correlated pair and reuses canonical weighting", () => {
    const evidence = buildResearchPortfolioDiversificationEvidence([
      series("a", "trend", a),
      series("b", "breakout", sameDirection),
      series("c", "mean-reversion", lowDependence),
    ]);
    const result = adviseCorrelationAwareLeagueCapitalAllocation(
      standing([entry("a", "trend", 1, 120), entry("b", "breakout", 2, 110), entry("c", "mean-reversion", 3, 90)]),
      evidence,
      { maximumCandidateWeight: 0.5 },
      0.7,
    );
    assert.deepEqual(result.excludedForDependence, ["b"]);
    assert.deepEqual(result.advisory.entries.map((candidate) => candidate.id), ["a", "c"]);
    assert.ok(result.reasons.includes("OVER_CORRELATED_CANDIDATES_EXCLUDED"));
    assert.ok(Math.abs(result.advisory.entries.reduce((sum, candidate) => sum + candidate.researchWeight, 0) - 1) < 1e-9);
  });

  it("treats anti-correlation as dependence rather than free diversification", () => {
    const evidence = buildResearchPortfolioDiversificationEvidence([
      series("a", "trend", a),
      series("b", "inverse", oppositeDirection),
      series("c", "other", lowDependence),
    ]);
    const result = adviseCorrelationAwareLeagueCapitalAllocation(
      standing([entry("a", "trend", 1, 120), entry("b", "inverse", 2, 110), entry("c", "other", 3, 90)]),
      evidence,
      { maximumCandidateWeight: 0.5 },
      0.7,
    );
    assert.deepEqual(result.excludedForDependence, ["b"]);
  });

  it("fails closed if pairwise evidence is removed or tampered", () => {
    const evidence = buildResearchPortfolioDiversificationEvidence([series("a", "trend", a), series("b", "breakout", sameDirection)]);
    const tampered = { ...evidence, pairs: Object.freeze([]) };
    assert.throws(
      () => adviseCorrelationAwareLeagueCapitalAllocation(standing([entry("a", "trend", 1, 120), entry("b", "breakout", 2, 100)]), tampered, { maximumCandidateWeight: 0.5 }),
      (error) => error instanceof ResearchPortfolioDiversificationError && error.code === "DIVERSIFICATION_EVIDENCE_FINGERPRINT_MISMATCH",
    );
  });

  it("discloses single-family evidence and never emits execution authority", () => {
    const evidence = buildResearchPortfolioDiversificationEvidence([
      series("a", "same-family", a),
      series("c", "same-family", lowDependence),
    ]);
    assert.ok(evidence.reasons.includes("SINGLE_FAMILY_EVIDENCE_BASE"));
    const serialized = JSON.stringify(evidence).toLowerCase();
    for (const forbidden of ["broker", "order", "capitalamount", "notional", "withdraw", "transfer", "activationlease"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.ok(evidence.reasons.includes("NO_EXECUTION_AUTHORITY"));
  });
});
