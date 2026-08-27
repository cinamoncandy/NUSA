import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptPersistedPaperPeriods, PersistedPaperPeriodAdapterError, type PersistedPaperPeriodRecord } from "./persistedPaperPeriodAdapter";
import { evaluateShadowAllocation } from "./shadowAllocationEvaluation";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";

function advisory(generatedAt: string, weights: Readonly<Record<string, number>>): LeagueCapitalAllocationAdvisory {
  const ids = Object.keys(weights);
  return {
    schemaVersion: 1,
    generatedAt,
    policy: { maximumCandidateWeight: 0.6, minimumEvidenceBreadth: 0.5, maximumCandidateCount: 5, maximumFamilyWeight: 0.6 },
    entries: ids.map((id, index) => ({
      id,
      familyId: "family-1",
      rank: index + 1,
      leagueScore: 100 - index,
      evidenceBreadth: 1,
      researchWeight: weights[id]!,
      reasons: ["NO_EXECUTION_AUTHORITY"],
      sourceDatasetIds: [`dataset-${id}`],
    })),
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ids.map((id) => `dataset-${id}`).sort() },
  };
}

const DAY = 86_400_000;
const BASE = Date.parse("2026-08-01T00:00:00.000Z");

function record(overrides: Partial<PersistedPaperPeriodRecord> = {}): PersistedPaperPeriodRecord {
  return {
    recordId: "record-0",
    periodIndex: 0,
    advisory: advisory(new Date(BASE - DAY).toISOString(), { a: 0.5, b: 0.5 }),
    periodStartAt: BASE,
    periodEndAt: BASE + DAY,
    realizedReturns: { a: 0.01, b: 0.02 },
    benchmarkReturn: 0.005,
    turnoverCostRate: 0.001,
    ...overrides,
  };
}

describe("adaptPersistedPaperPeriods", () => {
  it("converts a well-formed persisted record into shadow-allocation input the evaluator accepts", () => {
    const result = adaptPersistedPaperPeriods([record()]);
    assert.equal(result.periods.length, 1);
    assert.deepEqual(result.appliedRecordIds, ["record-0"]);
    assert.deepEqual(result.skippedDuplicateRecordIds, []);
    // Must actually be consumable by the real evaluator, not just structurally similar.
    const evaluation = evaluateShadowAllocation(result.periods);
    assert.equal(evaluation.periodCount, 1);
  });

  it("rejects an advisory generated at or after the period it is scored against as look-ahead", () => {
    const sameInstant = record({ advisory: advisory(new Date(BASE).toISOString(), { a: 1 }), realizedReturns: { a: 0.01 } });
    assert.throws(
      () => adaptPersistedPaperPeriods([sameInstant]),
      (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "LOOKAHEAD_ADVISORY_SNAPSHOT",
    );
    const afterPeriod = record({ advisory: advisory(new Date(BASE + DAY * 2).toISOString(), { a: 1 }), realizedReturns: { a: 0.01 } });
    assert.throws(
      () => adaptPersistedPaperPeriods([afterPeriod]),
      (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "LOOKAHEAD_ADVISORY_SNAPSHOT",
    );
  });

  it("blocks on broken candidate identity linkage in either direction rather than treating it as zero return", () => {
    // Advisory allocates to "c", but no realized return was supplied for it.
    assert.throws(
      () => adaptPersistedPaperPeriods([record({ advisory: advisory(new Date(BASE - DAY).toISOString(), { c: 1 }), realizedReturns: {} })]),
      (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "MISSING_REALIZED_RETURN_FOR_ADVISORY_ENTRY",
    );
    // A realized return exists for a candidate the advisory never allocated to.
    assert.throws(
      () => adaptPersistedPaperPeriods([record({ realizedReturns: { a: 0.01, b: 0.02, ghost: 0.5 } })]),
      (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "UNKNOWN_REALIZED_RETURN_CANDIDATE",
    );
  });

  it("skips a previously-applied recordId instead of double-counting it on replay", () => {
    const first = adaptPersistedPaperPeriods([record({ recordId: "r1" })]);
    assert.deepEqual(first.appliedRecordIds, ["r1"]);

    const alreadyApplied = new Set(first.appliedRecordIds);
    const replay = adaptPersistedPaperPeriods([record({ recordId: "r1" }), record({ recordId: "r2", periodIndex: 1 })], alreadyApplied);
    assert.deepEqual(replay.appliedRecordIds, ["r2"]);
    assert.deepEqual(replay.skippedDuplicateRecordIds, ["r1"]);
    assert.equal(replay.periods.length, 1, "a skipped duplicate must not reappear as a period");
  });

  it("fails closed on a duplicate recordId within the same call rather than silently applying it twice", () => {
    assert.throws(
      () => adaptPersistedPaperPeriods([record({ recordId: "dup" }), record({ recordId: "dup", periodIndex: 1 })]),
      (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "DUPLICATE_RECORD_ID_IN_BATCH",
    );
  });

  it("orders periods chronologically regardless of input order and preserves real cost evidence", () => {
    const second = record({ recordId: "r2", periodIndex: 1, advisory: advisory(new Date(BASE).toISOString(), { a: 1 }), periodStartAt: BASE + DAY, periodEndAt: BASE + DAY * 2, realizedReturns: { a: 0.03 } });
    const first = record({ recordId: "r1", periodIndex: 0 });
    const result = adaptPersistedPaperPeriods([second, first]);
    assert.deepEqual(result.periods.map((period) => period.periodIndex), [0, 1]);
    // Real cost evidence must survive the transform -- never silently zeroed.
    assert.equal(result.periods[0]!.turnoverCostRate, 0.001);
  });

  it("performs no filtering by outcome -- every supplied period is converted, never dropped for looking bad", () => {
    const losingPeriod = record({ realizedReturns: { a: -0.9, b: -0.9 } });
    const result = adaptPersistedPaperPeriods([losingPeriod]);
    assert.equal(result.periods.length, 1);
    assert.equal(result.periods[0]!.realizedReturns.a, -0.9);
  });

  it("fails closed on malformed period bounds, non-finite evidence, and negative cost rates", () => {
    assert.throws(() => adaptPersistedPaperPeriods([record({ recordId: "" })]), (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "INVALID_RECORD_ID");
    assert.throws(() => adaptPersistedPaperPeriods([record({ periodIndex: -1 })]), (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "INVALID_PERIOD_INDEX");
    assert.throws(() => adaptPersistedPaperPeriods([record({ periodEndAt: BASE - DAY })]), (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "INVALID_PERIOD_BOUNDS");
    assert.throws(() => adaptPersistedPaperPeriods([record({ benchmarkReturn: Number.NaN })]), (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "NON_FINITE_BENCHMARK_RETURN");
    assert.throws(() => adaptPersistedPaperPeriods([record({ turnoverCostRate: -0.01 })]), (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "NEGATIVE_COST_RATE");
    assert.throws(
      () => adaptPersistedPaperPeriods([record({ advisory: { ...advisory(new Date(BASE - DAY).toISOString(), { a: 1 }), schemaVersion: 2 as 1 } })]),
      (error) => error instanceof PersistedPaperPeriodAdapterError && error.code === "UNSUPPORTED_ADVISORY_SCHEMA",
    );
  });

  it("attaches the offending recordId to every thrown error for traceable replay debugging", () => {
    try {
      adaptPersistedPaperPeriods([record({ recordId: "traceable", realizedReturns: {} })]);
      assert.fail("expected a throw");
    } catch (error) {
      assert.ok(error instanceof PersistedPaperPeriodAdapterError);
      assert.equal(error.recordId, "traceable");
    }
  });
});
