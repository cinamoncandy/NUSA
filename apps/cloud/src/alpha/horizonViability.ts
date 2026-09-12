/**
 * Whether a strategy's holding horizon can pay what a round trip costs, before any question of
 * signal quality.
 *
 * The order-book imbalance alpha was built, tested, frozen and never questioned on this point,
 * and it could not have worked: it holds for seconds while a round trip on Upbit KRW spot costs
 * about 0.17%, and seconds do not move that far (ADR-0022, ADR-0023). The arithmetic was
 * available from the first day and nobody performed it, so the check exists here rather than in
 * a reviewer's head.
 *
 * The bound is deliberately generous to the strategy: it compares the cost against the MEDIAN
 * ABSOLUTE move, which is what a perfect direction-caller would collect. A horizon that fails
 * this cannot be traded profitably by anyone, whatever the signal. Passing it proves only that
 * the arithmetic is not already lost.
 */

export type HorizonVerdict = "VIABLE" | "MEDIAN_ONLY" | "COST_EXCEEDS_MOVEMENT" | "UNMEASURED";

export interface RoundTripCostModel {
  /** Paid once per round trip by a taker: bought at the ask, sold at the bid. */
  readonly spreadRate: number;
  /** Charged on each leg. Upbit KRW spot is 0.05% for maker and taker alike -- there is no rebate to earn. */
  readonly perLegFeeRate: number;
  readonly perLegSlippageRate: number;
}

export interface HorizonMovement {
  readonly horizonHours: number;
  /** Median |return| over the horizon: the take a perfect direction-caller collects. */
  readonly medianAbsoluteMoveRate: number;
  /** The 25th percentile. A strategy has to survive its quiet quarter, not only its median one. */
  readonly quietQuartileMoveRate: number;
  /** How the two rates above were measured, so a verdict can be traced to its evidence. */
  readonly sampleDescription: string;
}

export interface HorizonViabilityDecision {
  readonly verdict: HorizonVerdict;
  readonly roundTripRate: number;
  readonly horizonHours: number;
  /** Round-trip cost as a multiple of the quiet-quarter move. At or above 1 the quarter is lost. */
  readonly costToQuietMoveRatio: number | null;
  readonly reason: string;
}

/** Upbit KRW spot, measured 2026-09 (ADR-0023). Spread is the median across recorded books. */
export const UPBIT_KRW_SPOT_ROUND_TRIP: RoundTripCostModel = Object.freeze({
  spreadRate: 0.00032,
  perLegFeeRate: 0.0005,
  perLegSlippageRate: 0.0002
});

export function roundTripRate(cost: RoundTripCostModel): number {
  const rates = [cost.spreadRate, cost.perLegFeeRate, cost.perLegSlippageRate];
  if (!rates.every((rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0)) {
    throw new Error("round-trip cost rates must be non-negative finite numbers");
  }
  return cost.spreadRate + cost.perLegFeeRate * 2 + cost.perLegSlippageRate * 2;
}

const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Fails closed. Movement that was never measured is `UNMEASURED`, never a pass: a strategy whose
 * horizon economics nobody checked is exactly the case this guard exists for.
 */
export function evaluateHorizonViability(
  movement: HorizonMovement | undefined,
  cost: RoundTripCostModel = UPBIT_KRW_SPOT_ROUND_TRIP
): HorizonViabilityDecision {
  const rate = roundTripRate(cost);
  if (movement == null || !finitePositive(movement.horizonHours) || !movement.sampleDescription?.trim()) {
    return Object.freeze({
      verdict: "UNMEASURED", roundTripRate: rate, horizonHours: movement?.horizonHours ?? 0,
      costToQuietMoveRatio: null,
      reason: "no measured movement for this horizon; the arithmetic has not been done"
    });
  }
  const { horizonHours, medianAbsoluteMoveRate: median, quietQuartileMoveRate: quiet } = movement;
  if (!finitePositive(median) || !Number.isFinite(quiet) || quiet < 0) {
    return Object.freeze({
      verdict: "UNMEASURED", roundTripRate: rate, horizonHours, costToQuietMoveRatio: null,
      reason: "measured movement is not a usable pair of rates"
    });
  }
  if (quiet > median) throw new Error("quiet-quartile movement cannot exceed the median");

  const ratio = Number((rate / Math.max(quiet, Number.EPSILON)).toFixed(4));
  if (median <= rate) {
    return Object.freeze({
      verdict: "COST_EXCEEDS_MOVEMENT", roundTripRate: rate, horizonHours, costToQuietMoveRatio: ratio,
      reason: `a round trip costs ${(rate * 100).toFixed(3)}% and the median ${horizonHours}h window moves ${(median * 100).toFixed(3)}%; a perfect direction-caller would still lose`
    });
  }
  if (quiet <= rate) {
    return Object.freeze({
      verdict: "MEDIAN_ONLY", roundTripRate: rate, horizonHours, costToQuietMoveRatio: ratio,
      reason: `the median ${horizonHours}h window pays, but the quiet quarter moves ${(quiet * 100).toFixed(3)}% against a ${(rate * 100).toFixed(3)}% round trip`
    });
  }
  return Object.freeze({
    verdict: "VIABLE", roundTripRate: rate, horizonHours, costToQuietMoveRatio: ratio,
    reason: `the quiet quarter of ${horizonHours}h windows moves ${(quiet * 100).toFixed(3)}%, above a ${(rate * 100).toFixed(3)}% round trip`
  });
}

/**
 * Movement measured on Upbit KRW majors over 2000 hourly candles ending 2026-09-10
 * (`scripts/alpha/measure-candle-horizon-economics.js`). BTC and ETH clear the quiet quarter at
 * eight hours, XRP at four; eight is carried as the floor so a strategy is not sized to the
 * easiest major.
 */
export const UPBIT_MAJOR_HORIZON_FLOOR_HOURS = 8;
