import type { MarketStateFrame } from "./marketStateFrame";

export type RegimeHealthState = "HEALTHY" | "MIXED" | "STRESSED";

export interface RegimeHealthThresholds {
  readonly healthyBreadthMin: number;
  readonly stressedBreadthMax: number;
  readonly stressedMedianReturnMax: number;
  readonly stressedMedianDrawdownMax: number;
  readonly stressedMedianVolatilityMin: number;
}

export interface RegimeHealthAssessment {
  readonly schemaVersion: 1;
  readonly asOf: number;
  readonly state: RegimeHealthState;
  readonly score: number;
  readonly components: Readonly<{
    breadth: number;
    medianReturn: number;
    medianDrawdown: number;
    medianVolatility: number;
    dispersion: number;
  }>;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export class RegimeHealthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RegimeHealthError";
  }
}

const DEFAULT_THRESHOLDS: RegimeHealthThresholds = Object.freeze({
  healthyBreadthMin: 0.6,
  stressedBreadthMax: 0.35,
  stressedMedianReturnMax: -0.05,
  stressedMedianDrawdownMax: -0.12,
  stressedMedianVolatilityMin: 0.04,
});

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validateFrame(frame: MarketStateFrame): void {
  if (frame.schemaVersion !== 1) throw new RegimeHealthError("UNSUPPORTED_FRAME_SCHEMA", "market state frame schema is unsupported");
  if (frame.markets.length === 0) throw new RegimeHealthError("EMPTY_MARKET_STATE", "regime health requires at least one market");
  if (frame.aggregate.marketCount !== frame.markets.length) throw new RegimeHealthError("MARKET_COUNT_MISMATCH", "aggregate market count does not match market state");
  if (frame.sourceDatasetIds.length !== frame.markets.length) throw new RegimeHealthError("DATASET_ID_COUNT_MISMATCH", "source dataset ids do not match market state");
  for (const value of [frame.aggregate.positiveBreadth, frame.aggregate.medianLookbackReturn, frame.aggregate.medianRealizedVolatility, frame.aggregate.crossSectionalDispersion]) {
    if (!Number.isFinite(value)) throw new RegimeHealthError("NON_FINITE_AGGREGATE", "market state aggregate contains non-finite evidence");
  }
  if (frame.aggregate.positiveBreadth < 0 || frame.aggregate.positiveBreadth > 1) throw new RegimeHealthError("INVALID_BREADTH", "positive breadth must be between 0 and 1");
}

export function assessRegimeHealth(
  frame: MarketStateFrame,
  thresholds: RegimeHealthThresholds = DEFAULT_THRESHOLDS,
): RegimeHealthAssessment {
  validateFrame(frame);
  if (!(thresholds.stressedBreadthMax < thresholds.healthyBreadthMin)) throw new RegimeHealthError("INVALID_THRESHOLDS", "breadth thresholds must preserve a mixed region");

  const medianDrawdown = median(frame.markets.map((market) => market.maxDrawdown));
  const medianVolatility = frame.aggregate.medianRealizedVolatility;
  const reasons: string[] = [];

  const breadthStress = frame.aggregate.positiveBreadth <= thresholds.stressedBreadthMax;
  const returnStress = frame.aggregate.medianLookbackReturn <= thresholds.stressedMedianReturnMax;
  const drawdownStress = medianDrawdown <= thresholds.stressedMedianDrawdownMax;
  const volatilityStress = medianVolatility >= thresholds.stressedMedianVolatilityMin;
  const stressVotes = [breadthStress, returnStress, drawdownStress, volatilityStress].filter(Boolean).length;

  let state: RegimeHealthState;
  if (stressVotes >= 2) {
    state = "STRESSED";
    if (breadthStress) reasons.push("BREADTH_STRESS");
    if (returnStress) reasons.push("RETURN_STRESS");
    if (drawdownStress) reasons.push("DRAWDOWN_STRESS");
    if (volatilityStress) reasons.push("VOLATILITY_STRESS");
  } else if (frame.aggregate.positiveBreadth >= thresholds.healthyBreadthMin && frame.aggregate.medianLookbackReturn > 0 && medianDrawdown > thresholds.stressedMedianDrawdownMax) {
    state = "HEALTHY";
    reasons.push("BROAD_POSITIVE_PARTICIPATION");
  } else {
    state = "MIXED";
    reasons.push("CONFLICTING_MARKET_EVIDENCE");
  }

  const breadthScore = frame.aggregate.positiveBreadth;
  const returnScore = clamp01(0.5 + frame.aggregate.medianLookbackReturn * 2);
  const drawdownScore = clamp01(1 + medianDrawdown * 4);
  const volatilityScore = clamp01(1 - medianVolatility / Math.max(thresholds.stressedMedianVolatilityMin * 2, Number.EPSILON));
  const score = (breadthScore + returnScore + drawdownScore + volatilityScore) / 4;

  return Object.freeze({
    schemaVersion: 1,
    asOf: Math.max(...frame.markets.map((market) => market.asOf)),
    state,
    score,
    components: Object.freeze({
      breadth: frame.aggregate.positiveBreadth,
      medianReturn: frame.aggregate.medianLookbackReturn,
      medianDrawdown,
      medianVolatility,
      dispersion: frame.aggregate.crossSectionalDispersion,
    }),
    reasons: Object.freeze(reasons),
    sourceDatasetIds: Object.freeze([...frame.sourceDatasetIds]),
  });
}
