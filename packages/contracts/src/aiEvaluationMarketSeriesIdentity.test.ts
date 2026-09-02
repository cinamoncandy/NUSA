import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMarketSeriesSingleAdjustment, validateMarketSeriesIdentity, type MarketSeriesPoint } from "./aiEvaluationMarketSeriesIdentity";

const adjusted: readonly MarketSeriesPoint[] = [
  { seriesId: "s1", symbol: "AAPL", timestamp: 1000, adjustment: "ADJUSTED", value: 100, corporateActionIds: [] },
  { seriesId: "s1", symbol: "AAPL", timestamp: 2000, adjustment: "ADJUSTED", value: 50, corporateActionIds: ["split-2for1"] },
];
const unadjusted: readonly MarketSeriesPoint[] = [
  { seriesId: "s2", symbol: "AAPL", timestamp: 1000, adjustment: "UNADJUSTED", value: 100 },
  { seriesId: "s2", symbol: "AAPL", timestamp: 2000, adjustment: "UNADJUSTED", value: 102 },
];

describe("market-series identity", () => {
  it("accepts valid single-adjustment series", () => {
    assert.deepEqual(validateMarketSeriesIdentity(adjusted), { valid: true });
    assert.deepEqual(validateMarketSeriesIdentity(unadjusted), { valid: true });
    assert.equal(isMarketSeriesSingleAdjustment(adjusted, "ADJUSTED"), true);
  });
  it("rejects mixed adjustment semantics", () => {
    const mixed: readonly MarketSeriesPoint[] = [adjusted[0], { ...unadjusted[1], seriesId: "s1" }];
    const result = validateMarketSeriesIdentity(mixed);
    assert.equal(result.valid, false);
    assert.equal(isMarketSeriesSingleAdjustment(mixed, "ADJUSTED"), false);
  });
  it("rejects blank series and symbol identities", () => {
    for (const point of [
      { seriesId: "   ", symbol: "AAPL", timestamp: 1, adjustment: "UNADJUSTED", value: 1 },
      { seriesId: "s", symbol: "   ", timestamp: 1, adjustment: "UNADJUSTED", value: 1 },
    ] as readonly MarketSeriesPoint[]) {
      const result = validateMarketSeriesIdentity([point]);
      assert.equal(result.valid, false);
    }
  });
  it("requires corporate-action provenance for adjusted points", () => {
    const result = validateMarketSeriesIdentity([{ seriesId: "s", symbol: "A", timestamp: 1, adjustment: "ADJUSTED", value: 1 }]);
    assert.equal(result.valid, false);
  });
  it("rejects contradictory provenance, duplicate timestamps and non-finite values", () => {
    for (const series of [
      [{ seriesId: "s", symbol: "A", timestamp: 1, adjustment: "UNADJUSTED", value: 1, corporateActionIds: ["split"] }],
      [{ seriesId: "s", symbol: "A", timestamp: 1, adjustment: "UNADJUSTED", value: 1 }, { seriesId: "s", symbol: "A", timestamp: 1, adjustment: "UNADJUSTED", value: 2 }],
      [{ seriesId: "s", symbol: "A", timestamp: 1, adjustment: "UNADJUSTED", value: Number.NaN }],
    ] as readonly MarketSeriesPoint[][]) assert.equal(validateMarketSeriesIdentity(series).valid, false);
  });
});
