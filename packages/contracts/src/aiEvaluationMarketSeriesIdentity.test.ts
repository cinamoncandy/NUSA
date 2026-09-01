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
  it("accepts valid adjusted and unadjusted series", () => {
    assert.deepEqual(validateMarketSeriesIdentity(adjustedSeries()), { valid: true });
    assert.deepEqual(validateMarketSeriesIdentity(unadjustedSeries()), { valid: true });
  });
  it("rejects empty, mixed, malformed, and contradictory identities", () => {
    assert.deepEqual(validateMarketSeriesIdentity([]), { valid: false, errors: ["EMPTY_SERIES"] });
    const mixed: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100, corporateActionIds: [] },
      { seriesId: "s1", symbol: "AAPL", timestamp: 2_000, adjustment: "UNADJUSTED", value: 102 },
    ];
    assert.equal(validateMarketSeriesIdentity(mixed).valid, false);
    assert.equal(isMarketSeriesSingleAdjustment(mixed, "ADJUSTED"), false);

    for (const [point, error] of [
      [{ seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100 }, "ADJUSTED_POINT_MISSING_PROVENANCE"],
      [{ seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100, corporateActionIds: ["split"] }, "UNADJUSTED_POINT_HAS_PROVENANCE"],
      [{ seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "ADJUSTED", value: 100, corporateActionIds: [""] }, "ADJUSTED_POINT_MALFORMED_PROVENANCE"],
    ] as const) {
      const result = validateMarketSeriesIdentity([point as MarketSeriesPoint]);
      assert.equal(result.valid, false);
      assert.ok((result as { errors: readonly string[] }).errors.includes(error));
    }
  });
  it("rejects blank seriesId and symbol identities", () => {
    for (const [point, error] of [
      [{ seriesId: "   ", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100 }, "INVALID_SERIES_ID"],
      [{ seriesId: "s1", symbol: "   ", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100 }, "INVALID_SYMBOL"],
    ] as const) {
      const result = validateMarketSeriesIdentity([point as MarketSeriesPoint]);
      assert.equal(result.valid, false);
      assert.ok((result as { errors: readonly string[] }).errors.includes(error));
    }
  });
  it("rejects duplicate timestamps and non-finite values", () => {
    const duplicate: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 100 },
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: 101 },
    ];
    assert.ok((validateMarketSeriesIdentity(duplicate) as { errors: readonly string[] }).errors.includes("DUPLICATE_TIMESTAMP"));
    const malformed: readonly MarketSeriesPoint[] = [
      { seriesId: "s1", symbol: "AAPL", timestamp: 1_000, adjustment: "UNADJUSTED", value: Number.NaN },
    ];
    assert.ok((validateMarketSeriesIdentity(malformed) as { errors: readonly string[] }).errors.includes("NON_FINITE_VALUE"));
  });
});

describe("isMarketSeriesSingleAdjustment", () => {
  it("requires a valid matching adjustment identity", () => {
    assert.equal(isMarketSeriesSingleAdjustment(adjustedSeries(), "ADJUSTED"), true);
    assert.equal(isMarketSeriesSingleAdjustment(unadjustedSeries(), "UNADJUSTED"), true);
    assert.equal(isMarketSeriesSingleAdjustment(adjustedSeries(), "UNADJUSTED"), false);
    assert.equal(isMarketSeriesSingleAdjustment([], "ADJUSTED"), false);
  });
});
