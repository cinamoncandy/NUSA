import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeCandidateFailures, CandidateFailureAttributionError } from "./candidateFailureAttribution";
import type { LeagueCandidateComponents, LeagueRankedEntry, LeagueStanding } from "./nusaLeague";

function components(overrides: Partial<LeagueCandidateComponents> = {}): LeagueCandidateComponents {
  return {
    outOfSamplePerformance: 0.08,
    benchmarkExcess: 0.03,
    maximumDrawdown: 0.05,
    ...overrides,
  };
}

function entry(id: string, overrides: Partial<LeagueRankedEntry> = {}): LeagueRankedEntry {
  return {
    id,
    familyId: "family-1",
    eligible: true,
    outcome: "QUALIFIED_FOR_LEAGUE",
    reasons: [],
    evidenceBreadth: 1,
    components: components(),
    leagueScore: 100,
    rank: 1,
    sourceDatasetIds: [`dataset-${id}`],
    ...overrides,
  };
}

function standing(entries: readonly LeagueRankedEntry[]): LeagueStanding {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-27T00:00:00.000Z",
    policy: {
      probabilityBacktestOverfittingPenaltyWeight: 200,
      regimeRobustnessThreshold: 0.5,
      fragileEvidenceDiscount: 0.25,
      insufficientRegimeEvidenceDiscount: 0.5,
    },
    entries,
    coverage: { candidateCount: entries.length, eligibleCount: entries.filter((e) => e.eligible).length, familyCount: 1 },
    provenance: { sourceDatasetIds: [...new Set(entries.flatMap((e) => e.sourceDatasetIds))].sort() },
  };
}

function attributeSingle(componentOverrides: Partial<LeagueCandidateComponents> = {}, entryOverrides: Partial<LeagueRankedEntry> = {}) {
  const [attribution] = attributeCandidateFailures(standing([entry("a", { components: components(componentOverrides), ...entryOverrides })]));
  return attribution!;
}

describe("attributeCandidateFailures", () => {
  it("attributes no observed failure category to a clean candidate while calibration remains fail-closed", () => {
    const attribution = attributeSingle({
      benchmarkExcess: 0.03,
      maximumDrawdown: 0.04,
      riskAdjusted: 0.97,
      regimeRobustnessClass: "ROBUST",
      regimeRobustness: 0.9,
      costAdjustedGhostReturn: 0.075,
      counterfactualRegret: 0,
      paperNetReturn: 0.09,
      paperBacktestDivergence: -0.01,
      paperReliabilityPenalty: 0,
    });
    assert.deepEqual(attribution.categories, []);
    assert.deepEqual(attribution.insufficientEvidenceFor, ["CALIBRATION_ERROR"]);
    assert.ok(attribution.reasons.includes("CALIBRATION_ERROR_NO_DEDICATED_CALIBRATION_EVIDENCE"));
  });

  it("attributes REGIME_ERROR only for a real FRAGILE classification, never for INSUFFICIENT coverage", () => {
    assert.ok(attributeSingle({ regimeRobustnessClass: "FRAGILE" }).categories.includes("REGIME_ERROR"));

    const insufficient = attributeSingle({ regimeRobustnessClass: "INSUFFICIENT" });
    assert.equal(insufficient.categories.includes("REGIME_ERROR"), false);
    assert.ok(insufficient.insufficientEvidenceFor.includes("REGIME_ERROR"));
    assert.ok(attributeSingle().insufficientEvidenceFor.includes("REGIME_ERROR"));
  });

  it("attributes SIGNAL_FAILURE when the backtest never beat its own benchmark", () => {
    assert.ok(attributeSingle({ benchmarkExcess: -0.01 }).categories.includes("SIGNAL_FAILURE"));
  });

  it("attributes STRATEGY_DECAY only when real PAPER evidence significantly missed the backtest", () => {
    assert.ok(attributeSingle({ paperBacktestDivergence: 0.05 }).categories.includes("STRATEGY_DECAY"));
    assert.equal(attributeSingle({ paperBacktestDivergence: -0.01 }).categories.includes("STRATEGY_DECAY"), false);
    assert.ok(attributeSingle().insufficientEvidenceFor.includes("STRATEGY_DECAY"));
  });

  it("does not fabricate CALIBRATION_ERROR from high DSR probability plus one PAPER miss", () => {
    const highDsrMiss = attributeSingle({ riskAdjusted: 0.98, paperBacktestDivergence: 0.06 });
    assert.equal(highDsrMiss.categories.includes("CALIBRATION_ERROR"), false);
    assert.ok(highDsrMiss.categories.includes("STRATEGY_DECAY"));
    assert.ok(highDsrMiss.insufficientEvidenceFor.includes("CALIBRATION_ERROR"));
    assert.ok(highDsrMiss.reasons.includes("CALIBRATION_ERROR_NO_DEDICATED_CALIBRATION_EVIDENCE"));

    const highDsrMatch = attributeSingle({ riskAdjusted: 0.98, paperBacktestDivergence: -0.02 });
    assert.equal(highDsrMatch.categories.includes("CALIBRATION_ERROR"), false);
    assert.ok(highDsrMatch.insufficientEvidenceFor.includes("CALIBRATION_ERROR"));
  });

  it("attributes RISK_ERROR from excessive drawdown or observed counterfactual regret independently", () => {
    assert.ok(attributeSingle({ maximumDrawdown: 0.35 }).categories.includes("RISK_ERROR"));
    assert.ok(attributeSingle({ maximumDrawdown: 0.02, counterfactualRegret: 0.01 }).categories.includes("RISK_ERROR"));
    assert.equal(attributeSingle({ maximumDrawdown: 0.02, counterfactualRegret: 0 }).categories.includes("RISK_ERROR"), false);
  });

  it("attributes EXECUTION_COST only when a genuine positive edge was mostly consumed by realistic costs", () => {
    assert.ok(attributeSingle({ outOfSamplePerformance: 0.10, costAdjustedGhostReturn: 0.02 }).categories.includes("EXECUTION_COST"));
    assert.equal(attributeSingle({ outOfSamplePerformance: 0.10, costAdjustedGhostReturn: 0.09 }).categories.includes("EXECUTION_COST"), false);

    const noEdge = attributeSingle({ outOfSamplePerformance: -0.02 });
    assert.equal(noEdge.categories.includes("EXECUTION_COST"), false);
    assert.equal(noEdge.insufficientEvidenceFor.includes("EXECUTION_COST"), false);
  });

  it("attributes INFRASTRUCTURE_FAILURE from real operational risk, distinct from performance", () => {
    assert.ok(attributeSingle({ paperReliabilityPenalty: 0.4 }).categories.includes("INFRASTRUCTURE_FAILURE"));
    assert.equal(attributeSingle({ paperReliabilityPenalty: 0 }).categories.includes("INFRASTRUCTURE_FAILURE"), false);
    assert.ok(attributeSingle().insufficientEvidenceFor.includes("INFRASTRUCTURE_FAILURE"));
  });

  it("evaluates every candidate independently and preserves identity", () => {
    const result = attributeCandidateFailures(standing([
      entry("robust", { components: components({ regimeRobustnessClass: "ROBUST" }) }),
      entry("fragile", { familyId: "family-2", components: components({ regimeRobustnessClass: "FRAGILE" }) }),
    ]));
    assert.equal(result.length, 2);
    const fragile = result.find((attribution) => attribution.candidateId === "fragile")!;
    assert.equal(fragile.familyId, "family-2");
    assert.ok(fragile.categories.includes("REGIME_ERROR"));
    const robust = result.find((attribution) => attribution.candidateId === "robust")!;
    assert.equal(robust.categories.includes("REGIME_ERROR"), false);
  });

  it("fails closed on unsupported schema or invalid policy", () => {
    assert.throws(
      () => attributeCandidateFailures({ ...standing([entry("a")]), schemaVersion: 2 as 1 }),
      (error) => error instanceof CandidateFailureAttributionError && error.code === "UNSUPPORTED_LEAGUE_SCHEMA",
    );
    for (const bad of [
      { maximumAcceptableDrawdown: -1 },
      { minimumBenchmarkExcess: Number.NaN },
      { significantPaperDivergence: 0 },
      { significantCostErosion: 1.5 },
    ]) {
      assert.throws(
        () => attributeCandidateFailures(standing([entry("a")]), bad),
        (error) => error instanceof CandidateFailureAttributionError && error.code === "INVALID_POLICY",
        JSON.stringify(bad),
      );
    }
  });

  it("never emits a promotion, demotion, capital amount, order, or LIVE authority field", () => {
    const result = attributeCandidateFailures(standing([entry("a", { components: components({ regimeRobustnessClass: "FRAGILE", paperReliabilityPenalty: 0.5 }) })]));
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["liveauthority", "productionmutationallowed", "order", "broker", "withdraw", "transfer", "notional", "capitalamount", "promote", "demote", "retire"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});
