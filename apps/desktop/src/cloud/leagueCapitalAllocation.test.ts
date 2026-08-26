import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adviseLeagueCapitalAllocation, LeagueCapitalAllocationError } from "./leagueCapitalAllocation";
import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";

function entry(id: string, rank: number, leagueScore: number, overrides: Partial<LeagueRankedEntry> = {}): LeagueRankedEntry {
  return {
    id,
    familyId: `family-${id}`,
    eligible: true,
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
    policy: { probabilityBacktestOverfittingPenaltyWeight: 200 },
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
      entry("c", 3, 90, { eligible: false, leagueScore: undefined, rank: undefined }),
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
      () => adviseLeagueCapitalAllocation(standing([entry("a", 1, 120, { eligible: false, leagueScore: undefined, rank: undefined })])),
      (error: unknown) => error instanceof LeagueCapitalAllocationError && error.code === "NO_ALLOCATABLE_CANDIDATES",
    );
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
