import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMarketSeriesIdentity, isMarketSeriesSingleAdjustment, type MarketSeriesPoint } from "./aiEvaluationMarketSeriesIdentity";

function adjustedSeries(): readonly MarketSeriesPoint[] {
  return [
    { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100, corporateActionIds: [] },
    { seriesId: "s1", symbol: "AAPL", timestamp: 2_000, adjustment: "ADJUSTED", value: 50, corporateActionIds: ["split-2for1"] },
  ];
}

function unadjustedSeries(): readonly MarketSeriesPoint[] {
  return [
    { seriesId: "s2", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100 },
    { seriesId: "s2", symbol: "AAPL", timestamp: 2_000, adjustment: "UNADJUSTED", value: 102 },
  ];
}

describe("validateMarketSeriesIdentity", () => {
  it("accepts a well-formed ADJUSTED series with corporate-action provenance", () => {
    assert.deepEqual(validateMarketSeriesIdentity(adjustedSeries()), { valid: true });
  });

  it("accepts a well-formed UNADJUSTED series with no provenance", () => {
    assert.deepEqual(validateMarketSeriesIdentity(unadjustedSeries()), { valid: true });
  });

  it("rejects an empty series", () => {
    assert.deepEqual(validateMarketSeriesIdentity([]), { valid: false, errors: ["EMPTY_SERIES"] });
  });

  it("rejects a series mixing ADJUSTED and UNADJUSTED points (silent corruption risk)", () => {
    const mixed: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100, corporateActionIds: [] },
      { seriesId: "s1", symbol: "AAPL", timestamp: 2_000, adjustment: "UNADJUSTED", value: 102 },
    ];
    const result = validateMarketSeriesIdentity(mixed);
    assert.equal(result.valid, false);
    // no INVALID_ADJUSTMENT_TYPE-style error needed here -- both are individually valid adjustment
    // values, mixing is fine to allow at the type level but must be caught by the single-adjustment check
    assert.equal(isMarketSeriesSingleAdjustment(mixed, "ADJUSTED"), false);
  });

  it("rejects an ADJUSTED point missing corporateActionIds provenance", () => {
    const missing: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100 },
    ];
    const result = validateMarketSeriesIdentity(missing);
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("ADJUSTED_POINT_MISSING_PROVENANCE"));
  });

  it("rejects an UNADJUSTED point that carries corporateActionIds (contradiction)", () => {
    const contradictory: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100, corporateActionIds: ["split-2for1"] },
    ];
    const result = validateMarketSeriesIdentity(contradictory);
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("UNADJUSTED_POINT_HAS_PROVENANCE"));
  });

  it("rejects a series mixing seriesId or symbol", () => {
    const mixedSeriesId: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100 },
      { seriesId: "s2", symbol: "AAPL", timestamp: 2_000, adjustment: "UNADJUSTED", value: 102 },
    ];
    const result = validateMarketSeriesIdentity(mixedSeriesId);
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("MIXED_SERIES_ID"));
  });

  it("rejects duplicate timestamps", () => {
    const duplicate: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100 },
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 101 },
    ];
    const result = validateMarketSeriesIdentity(duplicate);
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("DUPLICATE_TIMESTAMP"));
  });

  it("rejects a non-finite value", () => {
    const malformed: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: Number.NaN },
    ];
    const result = validateMarketSeriesIdentity(malformed);
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("NON_FINITE_VALUE"));
  });

  it("rejects an ADJUSTED point with a malformed (blank) corporate-action id", () => {
    const malformed: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100, corporateActionIds: [""] },
    ];
    const result = validateMarketSeriesIdentity(malformed);
    assert.equal(result.valid, false);
    assert.ok((result as { errors: readonly string[] }).errors.includes("ADJUSTED_POINT_MALFORMED_PROVENANCE"));
  });
});

describe("isMarketSeriesSingleAdjustment", () => {
  it("is true for a valid, single-adjustment-type series matching the claimed type", () => {
    assert.equal(isMarketSeriesSingleAdjustment(adjustedSeries(), "ADJUSTED"), true);
    assert.equal(isMarketSeriesSingleAdjustment(unadjustedSeries(), "UNADJUSTED"), true);
  });

  it("is false when the claimed adjustment type does not match the series", () => {
    assert.equal(isMarketSeriesSingleAdjustment(adjustedSeries(), "UNADJUSTED"), false);
  });

  it("is false for an invalid series even if points share one adjustment type", () => {
    const invalid: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100 }, // missing provenance
    ];
    assert.equal(isMarketSeriesSingleAdjustment(invalid, "ADJUSTED"), false);
  });

  it("is false for an empty series", () => {
    assert.equal(isMarketSeriesSingleAdjustment([], "ADJUSTED"), false);
  });
});
