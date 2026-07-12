import type {
  MarketRegime,
  MarketRegimeFeatures,
  MarketRegimeSnapshot,
  MarketRegimeTransition,
  RegimeStrategyPolicy
} from "../../../packages/contracts/src/marketRegime";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const assertFinite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};

const validateFeatures = (features: MarketRegimeFeatures): void => {
  for (const [key, value] of Object.entries(features)) {
    if (key === "observedAt") continue;
    assertFinite(value as number, key);
  }
  if (!Number.isSafeInteger(features.observedAt) || features.observedAt < 0) {
    throw new Error("observedAt must be a non-negative safe integer");
  }
  if (features.breadthScore < -1 || features.breadthScore > 1) throw new Error("breadthScore must be between -1 and 1");
  if (features.riskScore < 0 || features.riskScore > 1) throw new Error("riskScore must be between 0 and 1");
};

interface Candidate {
  readonly regime: MarketRegime;
  readonly score: number;
  readonly reasons: readonly string[];
}

const candidates = (f: MarketRegimeFeatures): readonly Candidate[] => Object.freeze([
  { regime: "PANIC", score: Math.max(0, f.riskScore * 0.7 + Math.max(0, -f.returnZScore) * 0.15 + Math.max(0, f.liquidationZScore) * 0.15), reasons: ["RISK_SPIKE", "NEGATIVE_RETURN", "LIQUIDATION_PRESSURE"] },
  { regime: "SHORT_SQUEEZE", score: Math.max(0, Math.max(0, f.returnZScore) * 0.35 + Math.max(0, f.liquidationZScore) * 0.25 + Math.max(0, -f.fundingZScore) * 0.2 + Math.max(0, f.openInterestZScore) * 0.2), reasons: ["UP_MOVE", "SHORT_LIQUIDATIONS", "NEGATIVE_FUNDING", "OI_EXPANSION"] },
  { regime: "LONG_SQUEEZE", score: Math.max(0, Math.max(0, -f.returnZScore) * 0.35 + Math.max(0, f.liquidationZScore) * 0.25 + Math.max(0, f.fundingZScore) * 0.2 + Math.max(0, f.openInterestZScore) * 0.2), reasons: ["DOWN_MOVE", "LONG_LIQUIDATIONS", "POSITIVE_FUNDING", "OI_EXPANSION"] },
  { regime: "BREAKOUT", score: Math.max(0, Math.abs(f.returnZScore) * 0.3 + Math.max(0, f.volumeZScore) * 0.25 + Math.max(0, f.volatilityZScore) * 0.2 + Math.max(0, f.trendStrength) * 0.25), reasons: ["RETURN_EXTREME", "VOLUME_EXPANSION", "VOLATILITY_EXPANSION", "TREND_STRENGTH"] },
  { regime: "TREND_UP", score: Math.max(0, f.trendStrength * 0.5 + Math.max(0, f.returnZScore) * 0.3 + Math.max(0, f.breadthScore) * 0.2), reasons: ["POSITIVE_TREND", "POSITIVE_RETURN", "POSITIVE_BREADTH"] },
  { regime: "TREND_DOWN", score: Math.max(0, f.trendStrength * 0.5 + Math.max(0, -f.returnZScore) * 0.3 + Math.max(0, -f.breadthScore) * 0.2), reasons: ["NEGATIVE_TREND", "NEGATIVE_RETURN", "NEGATIVE_BREADTH"] },
  { regime: "HIGH_VOL", score: Math.max(0, f.volatilityZScore * 0.7 + Math.abs(f.returnZScore) * 0.3), reasons: ["VOLATILITY_HIGH", "RETURN_DISPERSION"] },
  { regime: "LOW_VOL", score: Math.max(0, -f.volatilityZScore * 0.7 + Math.max(0, -Math.abs(f.returnZScore)) * 0.3), reasons: ["VOLATILITY_LOW"] },
  { regime: "RISK_OFF", score: Math.max(0, f.riskScore * 0.65 + Math.max(0, -f.breadthScore) * 0.35), reasons: ["RISK_ELEVATED", "BREADTH_WEAK"] },
  { regime: "RISK_ON", score: Math.max(0, (1 - f.riskScore) * 0.6 + Math.max(0, f.breadthScore) * 0.4), reasons: ["RISK_SUBDUED", "BREADTH_STRONG"] },
  { regime: "RANGE", score: Math.max(0, (1 - Math.min(1, Math.abs(f.trendStrength))) * 0.5 + (1 - Math.min(1, Math.abs(f.returnZScore))) * 0.3 + (1 - Math.min(1, Math.max(0, f.volatilityZScore))) * 0.2), reasons: ["TREND_WEAK", "RETURN_CONTAINED", "VOLATILITY_CONTAINED"] }
]);

export function classifyMarketRegime(features: MarketRegimeFeatures): MarketRegimeSnapshot {
  validateFeatures(features);
  const ordered = [...candidates(features)].sort((a, b) => b.score - a.score || a.regime.localeCompare(b.regime));
  const first = ordered[0];
  const second = ordered[1];
  const confidence = clamp01(first.score / Math.max(1, first.score + second.score));
  const stability = clamp01(1 - Math.min(1, Math.abs(first.score - second.score) < 0.05 ? 0.7 : 0.2));
  return Object.freeze({
    regime: first.regime,
    confidence: round6(confidence),
    stability: round6(stability),
    reasons: Object.freeze([...first.reasons].sort()),
    observedAt: features.observedAt
  });
}

export function evaluateRegimeTransition(previous: MarketRegimeSnapshot | undefined, next: MarketRegimeSnapshot): MarketRegimeTransition {
  if (previous != null && next.observedAt < previous.observedAt) throw new Error("regime timestamps must be non-decreasing");
  const changed = previous == null || previous.regime !== next.regime;
  const transitionConfidence = changed
    ? clamp01(next.confidence * (0.5 + next.stability * 0.5))
    : clamp01((previous.confidence + next.confidence) / 2);
  return Object.freeze({
    from: previous?.regime,
    to: next.regime,
    changed,
    transitionConfidence: round6(transitionConfidence),
    observedAt: next.observedAt
  });
}

export function routeStrategiesForRegime(snapshot: MarketRegimeSnapshot): RegimeStrategyPolicy {
  const reasons: string[] = [];
  let allowTrend = false;
  let allowMeanReversion = false;
  let allowFundingCarry = false;
  let allowNewExposure = true;
  let exposureMultiplier = 1;

  switch (snapshot.regime) {
    case "TREND_UP":
    case "TREND_DOWN":
      allowTrend = true;
      allowFundingCarry = snapshot.confidence >= 0.55;
      reasons.push("TREND_STRATEGIES_ENABLED");
      break;
    case "RANGE":
    case "LOW_VOL":
      allowMeanReversion = true;
      allowFundingCarry = true;
      exposureMultiplier = 0.8;
      reasons.push("MEAN_REVERSION_ENABLED");
      break;
    case "PANIC":
    case "RISK_OFF":
    case "LONG_SQUEEZE":
      allowNewExposure = false;
      exposureMultiplier = 0;
      reasons.push("CAPITAL_PROTECTION_MODE");
      break;
    case "BREAKOUT":
    case "SHORT_SQUEEZE":
    case "HIGH_VOL":
      allowTrend = true;
      exposureMultiplier = 0.5;
      reasons.push("REDUCED_EXPOSURE_HIGH_VOLATILITY");
      break;
    case "RISK_ON":
      allowTrend = true;
      allowMeanReversion = true;
      allowFundingCarry = true;
      reasons.push("BROAD_STRATEGY_SET_ENABLED");
      break;
  }

  if (snapshot.confidence < 0.55 || snapshot.stability < 0.5) {
    exposureMultiplier = Math.min(exposureMultiplier, 0.5);
    reasons.push("LOW_REGIME_CERTAINTY");
  }

  return Object.freeze({
    allowTrend,
    allowMeanReversion,
    allowFundingCarry,
    allowNewExposure,
    exposureMultiplier: round6(exposureMultiplier),
    reasons: Object.freeze(reasons.sort())
  });
}
