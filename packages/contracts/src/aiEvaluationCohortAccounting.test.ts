import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCohortAccounting, isFullCohortAccountedFor, type CohortRecord } from "./aiEvaluationCohortAccounting";

function mixedCohort(): readonly CohortRecord[] {
  return [
    { predictionId: "p1", status: "RESOLVED" },
    { predictionId: "p2", status: "RESOLVED" },
    { predictionId: "p3", status: "BANKRUPT" },
    { predictionId: "p4", status: "CENSORED" },
    { predictionId: "p5", status: "ABSTAINED" },
  ];
}

describe("computeCohortAccounting", () => {
  it("counts every record toward totalCohortSize regardless of status", () => {
    const result = computeCohortAccounting(mixedCohort());
    assert.equal(result.resolved, true);
    assert.equal((result as { totalCohortSize: number }).totalCohortSize, 5);
  });

  it("computes coverageRatio against the full cohort, not just resolved records", () => {
    const result = computeCohortAccounting(mixedCohort());
    assert.equal((result as { coverageRatio: number }).coverageRatio, 2 / 5);
  });

  it("counts every status bucket, including zero-count statuses", () => {
    const result = computeCohortAccounting(mixedCohort());
    const counts = (result as { statusCounts: Record<string, number> }).statusCounts;
    assert.equal(counts.RESOLVED, 2);
    assert.equal(counts.BANKRUPT, 1);
    assert.equal(counts.CENSORED, 1);
    assert.equal(counts.ABSTAINED, 1);
    assert.equal(counts.DELISTED, 0);
    assert.equal(counts.STALE, 0);
    assert.equal(counts.PROVIDER_MISSING, 0);
    assert.equal(counts.UNRESOLVED, 0);
  });

  it("is coverageRatio 1 when every record is resolved", () => {
    const allResolved: readonly CohortRecord[] = [{ predictionId: "p1", status: "RESOLVED" }, { predictionId: "p2", status: "RESOLVED" }];
    const result = computeCohortAccounting(allResolved);
    assert.equal((result as { coverageRatio: number }).coverageRatio, 1);
  });

  it("is coverageRatio 0, not an error, when nothing resolved (hard cases still counted)", () => {
    const noneResolved: readonly CohortRecord[] = [{ predictionId: "p1", status: "BANKRUPT" }, { predictionId: "p2", status: "STALE" }];
    const result = computeCohortAccounting(noneResolved);
    assert.equal(result.resolved, true);
    assert.equal((result as { coverageRatio: number }).coverageRatio, 0);
  });

  it("fails closed on an empty cohort", () => {
    assert.deepEqual(computeCohortAccounting([]), { resolved: false, reason: "EMPTY_COHORT" });
  });

  it("fails closed on a duplicate predictionId (would silently miscount)", () => {
    const duplicate: readonly CohortRecord[] = [{ predictionId: "p1", status: "RESOLVED" }, { predictionId: "p1", status: "BANKRUPT" }];
    assert.deepEqual(computeCohortAccounting(duplicate), { resolved: false, reason: "DUPLICATE_PREDICTION_ID" });
  });
});

describe("isFullCohortAccountedFor", () => {
  it("is true when every full-cohort id appears exactly once in records", () => {
    assert.equal(isFullCohortAccountedFor(["p1", "p2", "p3", "p4", "p5"], mixedCohort()), true);
  });

  it("is false when a hard-case id was silently dropped from records (e.g. excluded after bankruptcy)", () => {
    const dropped = mixedCohort().filter((r) => r.predictionId !== "p3");
    assert.equal(isFullCohortAccountedFor(["p1", "p2", "p3", "p4", "p5"], dropped), false);
  });

  it("is false when a full-cohort id appears more than once (double-counting risk)", () => {
    const duplicated = [...mixedCohort(), { predictionId: "p1", status: "RESOLVED" as const }];
    assert.equal(isFullCohortAccountedFor(["p1", "p2", "p3", "p4", "p5"], duplicated), false);
  });

  it("is false for an empty fullCohortIds list rather than vacuously true", () => {
    assert.equal(isFullCohortAccountedFor([], mixedCohort()), false);
  });
});
