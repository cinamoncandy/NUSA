/**
 * Explicit adjusted/unadjusted market-series identity and corporate-action provenance for AI
 * prediction evaluation (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 */

export type MarketSeriesAdjustment = "ADJUSTED" | "UNADJUSTED";

export interface MarketSeriesPoint {
  readonly seriesId: string;
  readonly symbol: string;
  readonly timestamp: number;
  readonly adjustment: MarketSeriesAdjustment;
  readonly value: number;
  readonly corporateActionIds?: readonly string[];
}

export type MarketSeriesIdentityValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNonBlankString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function validateMarketSeriesIdentity(points: readonly MarketSeriesPoint[]): MarketSeriesIdentityValidation {
  if (points.length === 0) return { valid: false, errors: ["EMPTY_SERIES"] };

  const errors = new Set<string>();
  const seriesId = points[0].seriesId;
  const symbol = points[0].symbol;
  const adjustment = points[0].adjustment;
  const seenTimestamps = new Set<number>();

  for (const point of points) {
    if (!isNonBlankString(point.seriesId)) errors.add("INVALID_SERIES_ID");
    else if (point.seriesId !== seriesId) errors.add("MIXED_SERIES_ID");
    if (!isNonBlankString(point.symbol)) errors.add("INVALID_SYMBOL");
    else if (point.symbol !== symbol) errors.add("MIXED_SYMBOL");
    if (point.adjustment !== adjustment) errors.add("MIXED_ADJUSTMENT_TYPE");
    if (!isTimestamp(point.timestamp)) errors.add("INVALID_TIMESTAMP");
    else if (seenTimestamps.has(point.timestamp)) errors.add("DUPLICATE_TIMESTAMP");
    else seenTimestamps.add(point.timestamp);
    if (!Number.isFinite(point.value)) errors.add("NON_FINITE_VALUE");

    if (point.adjustment === "ADJUSTED") {
      if (!Array.isArray(point.corporateActionIds)) errors.add("ADJUSTED_POINT_MISSING_PROVENANCE");
      else if (point.corporateActionIds.some((id) => typeof id !== "string" || !id.trim())) errors.add("ADJUSTED_POINT_MALFORMED_PROVENANCE");
    } else if (point.adjustment === "UNADJUSTED") {
      if (point.corporateActionIds !== undefined && point.corporateActionIds.length > 0) errors.add("UNADJUSTED_POINT_HAS_PROVENANCE");
    } else {
      errors.add("INVALID_ADJUSTMENT_TYPE");
    }
  }

  return errors.size === 0 ? { valid: true } : { valid: false, errors: Object.freeze([...errors]) };
}

export function isMarketSeriesSingleAdjustment(points: readonly MarketSeriesPoint[], adjustment: MarketSeriesAdjustment): boolean {
  if (points.length === 0) return false;
  if (!validateMarketSeriesIdentity(points).valid) return false;
  return points.every((point) => point.adjustment === adjustment);
}
