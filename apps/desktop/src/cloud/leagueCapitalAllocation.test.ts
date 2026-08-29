import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adviseLeagueCapitalAllocation, LeagueCapitalAllocationError } from "./leagueCapitalAllocation";
import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";

function entry(id: string, rank: number, leagueScore: number, overrides: Partial<LeagueRankedEntry> = {}): LeagueRankedEntry {
  return {
    id,
    familyId: `family-${id}`,
    eligible: true,
    outcome: "QUALIFIED_FOR_LEAGUE",
    reasons: [],
    evidenceBreadth: 1,
    components: { outOfSamplePerformance: 0.05, benchmarkExcess: 0.02, maximumDrawdown: 0.04 },
    leagueScore,
    rank,
    sourceDatasetIds: [`dataset-${id}`],
    ...overrides,
  };
}

function standing(entries: readonly LeagueRankedEntry[]): LeagueStanding {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-26T01:40:00.000Z",
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

describe("adviseLeagueCapitalAllocation", () => {
  it("produces capped normalized research-only weights from League standings", () => {
    const advisory = adviseLeagueCapitalAllocation(standing([
      entry("a", 1, 120), entry("b", 2, 100), entry("c", 3, 80),
    ]), { maximumCandidateWeight: 0.4 });

    assert.equal(advisory.entries.length, 3);
    assert.ok(advisory.entries[0]!.researchWeight >= advisory.entries[1]!.researchWeight);
    assert.ok(advisory.entries[1]!.researchWeight >= advisory.entries[2]!.researchWeight);
    assert.ok(advisory.entries.every((candidate) => candidate.researchWeight <= 0.4 + 1e-12));
    assert.ok(Math.abs(advisory.entries.reduce((sum, candidate) => sum + candidate.researchWeight, 0) - 1) < 1e-9);
    assert.deepEqual(advisory.provenance.sourceDatasetIds, ["dataset-a", "dataset-b", "dataset-c"]);
  });

  it("excludes benchmark-ineligible and insufficient-evidence candidates", () => {
    const advisory = adviseLeagueCapitalAllocation(standing([
      entry("a", 1, 120),
      entry("b", 2, 100, { evidenceBreadth: 0.25 }),
      entry("c", 3, 90, { eligible: false, outcome: "REJECTED", leagueScore: undefined, rank: undefined }),
      entry("d", 4, 80),
    ]), { maximumCandidateWeight: 0.5, minimumEvidenceBreadth: 0.5 });

    assert.deepEqual(advisory.entries.map((candidate) => candidate.id), ["a", "d"]);
    assert.deepEqual(advisory.excludedCandidateIds, ["b", "c"]);
  });

  it("keeps equal-score candidates equally weighted", () => {
    const advisory = adviseLeagueCapitalAllocation(standing([
      entry("a", 1, 100), entry("b", 2, 100), entry("c", 3, 100),
    ]), { maximumCandidateWeight: 0.5 });
    for (const candidate of advisory.entries) assert.ok(Math.abs(candidate.researchWeight - 1 / 3) < 1e-9);
  });

  it("fails closed when policy caps cannot form a complete diversified allocation", () => {
    assert.throws(
      () => adviseLeagueCapitalAllocation(standing([entry("a", 1, 120), entry("b", 2, 100)]), { maximumCandidateWeight: 0.4 }),
      (error: unknown) => error instanceof LeagueCapitalAllocationError && error.code === "INSUFFICIENT_DIVERSIFICATION_CAPACITY",
    );
  });

  it("fails closed when no candidate has sufficient eligible evidence", () => {
    assert.throws(
      () => adviseLeagueCapitalAllocation(standing([entry("a", 1, 120, { eligible: false, outcome: "REJECTED", leagueScore: undefined, rank: undefined })])),
      (error: unknown) => error instanceof LeagueCapitalAllocationError && error.code === "NO_ALLOCATABLE_CANDIDATES",
    );
  });

  it("stops one strategy family from owning the book through tuned variants", () => {
    // Adversarial case F, and the realistic one: a parameter neighborhood produces several tuned
    // variants of ONE family. Each stays under the per-candidate cap while the family collectively
    // owns almost everything -- correlated risk wearing the costume of a diversified book.
    const familyOf = (id: string, familyId: string, rank: number, score: number) =>
      entry(id, rank, score, { familyId });
    const advisory = adviseLeagueCapitalAllocation(standing([
      familyOf("sma-3-15", "sma-crossover", 1, 120),
      familyOf("sma-5-15", "sma-crossover", 2, 118),
      familyOf("sma-5-20", "sma-crossover", 3, 116),
      familyOf("meanrev-1", "mean-reversion", 4, 95),
      familyOf("meanrev-2", "mean-reversion", 5, 90),
    ]));

    const byFamily = new Map<string, number>();
    for (const item of advisory.entries) {
      byFamily.set(item.familyId, (byFamily.get(item.familyId) ?? 0) + item.researchWeight);
    }
    for (const [familyId, weight] of byFamily) {
      assert.ok(weight <= advisory.policy.maximumFamilyWeight + 1e-9, `${familyId} holds ${weight}`);
    }
    assert.ok(advisory.reasons.includes("FAMILY_CONCENTRATION_CAPPED"));
    // Still a complete, normalized allocation.
    assert.ok(Math.abs(advisory.entries.reduce((sum, item) => sum + item.researchWeight, 0) - 1) < 1e-9);
  });

  it("fails closed when both caps together cannot form a complete allocation", () => {
    // 3 variants of one family plus a single lone alternative: the family cap holds the big family
    // to 0.5 while the lone candidate cannot exceed its own 0.4 cap, so 100% is unreachable.
    // That is a real diversification shortfall and must be reported as one, not silently rescaled.
    assert.throws(
      () => adviseLeagueCapitalAllocation(standing([
        entry("a", 1, 120, { familyId: "sma" }),
        entry("b", 2, 118, { familyId: "sma" }),
        entry("c", 3, 116, { familyId: "sma" }),
        entry("d", 4, 90, { familyId: "mean-reversion" }),
      ])),
      (error) => error instanceof LeagueCapitalAllocationError && error.code === "INSUFFICIENT_DIVERSIFICATION_CAPACITY",
    );
  });

  it("discloses a single-family evidence base instead of calling it diversified", () => {
    const advisory = adviseLeagueCapitalAllocation(standing([
      entry("a", 1, 120, { familyId: "sma" }),
      entry("b", 2, 100, { familyId: "sma" }),
      entry("c", 3, 90, { familyId: "sma" }),
    ]));
    // Nothing to diversify into, so the family cap cannot bind -- but it must be stated plainly.
    assert.ok(advisory.reasons.includes("SINGLE_FAMILY_EVIDENCE_BASE"));
    assert.equal(advisory.reasons.includes("FAMILY_CONCENTRATION_CAPPED"), false);
    assert.ok(Math.abs(advisory.entries.reduce((sum, item) => sum + item.researchWeight, 0) - 1) < 1e-9);
  });

  it("rejects a family cap below the candidate cap as incoherent", () => {
    assert.throws(
      () => adviseLeagueCapitalAllocation(
        standing([entry("a", 1, 120), entry("b", 2, 100), entry("c", 3, 90)]),
        { maximumCandidateWeight: 0.5, maximumFamilyWeight: 0.3 },
      ),
      (error) => error instanceof LeagueCapitalAllocationError && error.code === "INVALID_POLICY",
    );
  });

  it("keeps family-capped allocation deterministic under input permutation", () => {
    const build = () => [
      entry("s1", 1, 120, { familyId: "sma" }),
      entry("s2", 2, 118, { familyId: "sma" }),
      entry("s3", 3, 116, { familyId: "sma" }),
      entry("m1", 4, 95, { familyId: "mean-reversion" }),
      entry("m2", 5, 90, { familyId: "mean-reversion" }),
    ];
    const forward = adviseLeagueCapitalAllocation(standing(build()));
    const reversed = adviseLeagueCapitalAllocation(standing([...build()].reverse()));
    const key = (advisory: typeof forward) => advisory.entries
      .map((item) => [item.id, item.researchWeight] as const)
      .sort((left, right) => left[0].localeCompare(right[0]));
    assert.deepEqual(key(forward), key(reversed));
  });

  it("never emits execution, broker, order, liveAuthority, or capital amount fields", () => {
    const advisory = adviseLeagueCapitalAllocation(standing([
      entry("a", 1, 120), entry("b", 2, 100), entry("c", 3, 80),
    ]), { maximumCandidateWeight: 0.4 });
    const serialized = JSON.stringify(advisory).toLowerCase();
    for (const forbidden of ["broker", "order", "liveauthority", "capitalamount", "notional", "withdraw", "transfer"]) {
      assert.equal(serialized.includes(forbidden), false, `unexpected executable field marker: ${forbidden}`);
    }
  });
});
