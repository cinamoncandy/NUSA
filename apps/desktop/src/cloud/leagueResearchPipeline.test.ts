import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchBenchmarkSliceScore } from "./researchBenchmarkScorecard";
import type { LeagueCandidateInput } from "./nusaLeague";
import { runLeagueResearchPipeline } from "./leagueResearchPipeline";

function benchmark(id: string, datasetId: string, totalReturn: number): ResearchBenchmarkSliceScore {
  return {
    id,
    datasetId,
    contentSha256: "a".repeat(64),
    market: "KRW-BTC",
    interval: "1d",
    candleCount: 200,
    windowCount: 4,
    totalOosPoints: 80,
    totalOosClosedTrades: 12,
    totalReturn,
    maximumDrawdown: 0.08,
    averageBenchmarkReturn: 0.01,
    averageOutperformance: totalReturn - 0.01,
    profitableWindowRatio: 0.75,
    benchmarkOutperformanceWindowRatio: 0.75,
    turnover: 1.2,
    totalTradingCost: 0.01,
    tradingCostBurden: 0.001,
    selectionChurnRatio: 0.25,
    returnToDrawdown: totalReturn / 0.08,
    eligible: true,
    reasons: [],
    researchScore: totalReturn * 1_000,
  };
}

function candidate(id: string, totalReturn: number): LeagueCandidateInput {
  return {
    id,
    familyId: `family-${id}`,
    benchmark: benchmark(id, `dataset-${id}`, totalReturn),
  };
}

describe("runLeagueResearchPipeline", () => {
  it("composes deterministic League ranking into bounded research allocation", () => {
    const result = runLeagueResearchPipeline({
      candidates: [candidate("c", 0.08), candidate("a", 0.12), candidate("b", 0.10)],
      generatedAt: "2026-08-26T04:15:00.000Z",
      allocationPolicy: { maximumCandidateWeight: 0.5, minimumEvidenceBreadth: 0 },
    });

    assert.equal(result.schemaVersion, 1);
    assert.deepEqual(result.standing.entries.map((entry) => entry.id), ["a", "b", "c"]);
    assert.deepEqual(result.allocation.entries.map((entry) => entry.id), ["a", "b", "c"]);
    assert.ok(result.allocation.entries[0]!.researchWeight >= result.allocation.entries[1]!.researchWeight);
    assert.ok(Math.abs(result.allocation.entries.reduce((sum, entry) => sum + entry.researchWeight, 0) - 1) < 1e-9);
    assert.deepEqual(result.allocation.provenance.sourceDatasetIds, ["dataset-a", "dataset-b", "dataset-c"]);
  });

  it("is input-order independent", () => {
    const options = {
      generatedAt: "2026-08-26T04:15:00.000Z",
      allocationPolicy: { maximumCandidateWeight: 0.5, minimumEvidenceBreadth: 0 },
    } as const;
    const first = runLeagueResearchPipeline({ ...options, candidates: [candidate("a", 0.12), candidate("b", 0.10), candidate("c", 0.08)] });
    const second = runLeagueResearchPipeline({ ...options, candidates: [candidate("c", 0.08), candidate("a", 0.12), candidate("b", 0.10)] });
    assert.deepEqual(first, second);
  });

  it("preserves the research-only authority boundary", () => {
    const result = runLeagueResearchPipeline({
      candidates: [candidate("a", 0.12), candidate("b", 0.10), candidate("c", 0.08)],
      allocationPolicy: { maximumCandidateWeight: 0.5, minimumEvidenceBreadth: 0 },
    });
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["broker", "order", "liveauthority", "capitalamount", "notional", "withdraw", "transfer", "credential"]) {
      assert.equal(serialized.includes(forbidden), false, `unexpected executable field marker: ${forbidden}`);
    }
  });
});
