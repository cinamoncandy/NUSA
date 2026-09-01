import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDataVintage, isDataVintageConsistent, type DataVintageRevision } from "./aiEvaluationDataVintage";

function revisions(): readonly DataVintageRevision[] {
  return [
    { revisionId: "r1", factKey: "AAPL:EPS:2025Q3", publishedAt: 1_000, value: 1.1 },
    { revisionId: "r2", factKey: "AAPL:EPS:2025Q3", publishedAt: 2_000, value: 1.15 }, // later revised/corrected value
    { revisionId: "r3", factKey: "AAPL:EPS:2025Q3", publishedAt: 3_000, value: 1.2 }, // even later revision
    { revisionId: "r4", factKey: "MSFT:EPS:2025Q3", publishedAt: 1_500, value: 3.3 },
  ];
}

describe("resolveDataVintage", () => {
  it("resolves the most recent revision published at or before predictionTime", () => {
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", 2_500, revisions()), {
      resolved: true, revisionId: "r2", value: 1.15, publishedAt: 2_000,
    });
  });

  it("never returns a revision published after predictionTime, even if it is the 'current' value downstream", () => {
    const result = resolveDataVintage("AAPL:EPS:2025Q3", 1_500, revisions());
    assert.equal(result.resolved, true);
    assert.equal((result as { revisionId: string }).revisionId, "r1");
  });

  it("treats publishedAt as inclusive of predictionTime", () => {
    const result = resolveDataVintage("AAPL:EPS:2025Q3", 2_000, revisions());
    assert.equal((result as { revisionId: string }).revisionId, "r2");
  });

  it("fails closed when no revision of the fact had been published yet", () => {
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", 500, revisions()), {
      resolved: false, reason: "NO_PUBLISHED_REVISION_AT_PREDICTION_TIME",
    });
  });

  it("fails closed for an unknown factKey", () => {
    assert.deepEqual(resolveDataVintage("TSLA:EPS:2025Q3", 5_000, revisions()), {
      resolved: false, reason: "NO_PUBLISHED_REVISION_AT_PREDICTION_TIME",
    });
  });

  it("fails closed on an invalid predictionTime", () => {
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", Number.NaN, revisions()), {
      resolved: false, reason: "INVALID_PREDICTION_TIME",
    });
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", -1, revisions()), {
      resolved: false, reason: "INVALID_PREDICTION_TIME",
    });
  });

  it("fails closed on an empty revision set", () => {
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", 5_000, []), { resolved: false, reason: "INVALID_REVISION_SET" });
  });

  it("fails closed on a malformed revision (non-finite value)", () => {
    const malformed: readonly DataVintageRevision[] = [{ revisionId: "r1", factKey: "AAPL:EPS:2025Q3", publishedAt: 1_000, value: Number.NaN }];
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", 5_000, malformed), { resolved: false, reason: "INVALID_REVISION_SET" });
  });

  it("fails closed on a duplicate revisionId", () => {
    const duplicate: readonly DataVintageRevision[] = [
      { revisionId: "r1", factKey: "AAPL:EPS:2025Q3", publishedAt: 1_000, value: 1.1 },
      { revisionId: "r1", factKey: "AAPL:EPS:2025Q3", publishedAt: 2_000, value: 1.15 },
    ];
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", 5_000, duplicate), { resolved: false, reason: "INVALID_REVISION_SET" });
  });

  it("fails closed as ambiguous when two revisions of the same fact publish at the same instant with different values", () => {
    const simultaneous: readonly DataVintageRevision[] = [
      { revisionId: "r1", factKey: "AAPL:EPS:2025Q3", publishedAt: 1_000, value: 1.1 },
      { revisionId: "r2", factKey: "AAPL:EPS:2025Q3", publishedAt: 1_000, value: 1.2 },
    ];
    assert.deepEqual(resolveDataVintage("AAPL:EPS:2025Q3", 5_000, simultaneous), { resolved: false, reason: "AMBIGUOUS_SIMULTANEOUS_REVISIONS" });
  });

  it("does not treat identical-value simultaneous publications as ambiguous", () => {
    const simultaneous: readonly DataVintageRevision[] = [
      { revisionId: "r1", factKey: "AAPL:EPS:2025Q3", publishedAt: 1_000, value: 1.1 },
      { revisionId: "r2", factKey: "AAPL:EPS:2025Q3", publishedAt: 1_000, value: 1.1 },
    ];
    const result = resolveDataVintage("AAPL:EPS:2025Q3", 5_000, simultaneous);
    assert.equal(result.resolved, true);
  });
});

describe("isDataVintageConsistent", () => {
  it("is true when every used revision matches the independently resolved point-in-time vintage", () => {
    const used = [{ factKey: "AAPL:EPS:2025Q3", revisionId: "r1" }, { factKey: "MSFT:EPS:2025Q3", revisionId: "r4" }];
    assert.equal(isDataVintageConsistent(1_500, used, revisions()), true);
  });

  it("is false when a used revision is a later, not-yet-published revision (future leakage)", () => {
    const used = [{ factKey: "AAPL:EPS:2025Q3", revisionId: "r3" }];
    assert.equal(isDataVintageConsistent(1_500, used, revisions()), false);
  });

  it("is false when a used revision is a stale one superseded by a revision that was already published", () => {
    const used = [{ factKey: "AAPL:EPS:2025Q3", revisionId: "r1" }];
    assert.equal(isDataVintageConsistent(2_500, used, revisions()), false);
  });

  it("is false for an empty used-revisions set rather than vacuously true", () => {
    assert.equal(isDataVintageConsistent(2_500, [], revisions()), false);
  });
});
