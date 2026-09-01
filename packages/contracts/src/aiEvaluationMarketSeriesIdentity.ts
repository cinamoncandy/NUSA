/**
 * Explicit adjusted/unadjusted market-series identity and corporate-action provenance for AI
 * prediction evaluation (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "explicit adjusted/
 * unadjusted market-series identity and corporate-action provenance" requirement: a market-price
 * series used as evidence or as an outcome-resolution basis must declare, per point, whether it
 * is ADJUSTED (for splits/dividends/spinoffs) or UNADJUSTED, and every ADJUSTED point must carry
 * the corporate-action ids it applied. Silently mixing adjusted and unadjusted points in the same
 * series, or presenting an adjustment without provenance, would corrupt return calculations
 * (e.g. a phantom "gap" from an unaccounted stock split) without any visible signal that
 * something was wrong.
 */

export type MarketSeriesAdjustment = "ADJUSTED" | "UNADJUSTED";

export interface MarketSeriesPoint {
  readonly seriesId: string;
  readonly symbol: string;
  readonly timestamp: number;
  readonly adjustment: MarketSeriesAdjustment;
  readonly value: number;
  /** Corporate-action ids this point's adjustment applied. Required (possibly empty array) when
   * adjustment is ADJUSTED; must be absent/empty when adjustment is UNADJUSTED. */
  readonly corporateActionIds?: readonly string[];
}

export type MarketSeriesIdentityValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isIdentity = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * Validates a single market-price series: every point carries non-empty seriesId/symbol identity,
 * every point shares the same seriesId/symbol, no duplicate timestamps, values are finite, every
 * ADJUSTED point declares a corporateActionIds array (may be empty -- e.g. adjusted-but-no-action-
 * applied-yet -- but must be present and well-formed), and no UNADJUSTED point carries
 * corporateActionIds (that would be a contradiction in terms). Fails closed: any of these
 * violations makes the whole series invalid rather than silently accepting the well-formed points
 * and dropping the rest.
 */
export function validateMarketSeriesIdentity(points: readonly MarketSeriesPoint[]): MarketSeriesIdentityValidation {
  if (points.length === 0) return { valid: false, errors: ["EMPTY_SERIES"] };

  const errors = new Set<string>();
  const seriesId = points[0].seriesId;
  const symbol = points[0].symbol;
  const adjustment = points[0].adjustment;
  const seenTimestamps = new Set<number>();

  for (const point of points) {
    if (!isIdentity(point.seriesId)) errors.add("INVALID_SERIES_ID");
    if (!isIdentity(point.symbol)) errors.add("INVALID_SYMBOL");
    if (point.seriesId !== seriesId) errors.add("MIXED_SERIES_ID");
    if (point.symbol !== symbol) errors.add("MIXED_SYMBOL");
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

/**
 * True only when every point in the series has the given adjustment type -- the structural check
 * that a series claimed/consumed as e.g. "the ADJUSTED close series" does not silently contain
 * UNADJUSTED points (or vice versa), which would corrupt any return/backtest computed from it.
 */
export function isMarketSeriesSingleAdjustment(points: readonly MarketSeriesPoint[], adjustment: MarketSeriesAdjustment): boolean {
  if (points.length === 0) return false;
  if (!validateMarketSeriesIdentity(points).valid) return false;
  return points.every((point) => point.adjustment === adjustment);
}
