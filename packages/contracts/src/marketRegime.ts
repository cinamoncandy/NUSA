export type MarketRegime =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "BREAKOUT"
  | "PANIC"
  | "SHORT_SQUEEZE"
  | "LONG_SQUEEZE"
  | "HIGH_VOL"
  | "LOW_VOL"
  | "RISK_ON"
  | "RISK_OFF";

export interface MarketRegimeFeatures {
  readonly trendStrength: number;
  readonly returnZScore: number;
  readonly volatilityZScore: number;
  readonly volumeZScore: number;
  readonly fundingZScore: number;
  readonly openInterestZScore: number;
  readonly liquidationZScore: number;
  readonly breadthScore: number;
  readonly riskScore: number;
  readonly observedAt: number;
}

export interface MarketRegimeSnapshot {
  readonly regime: MarketRegime;
  readonly confidence: number;
  readonly stability: number;
  readonly reasons: readonly string[];
  readonly observedAt: number;
}

export interface MarketRegimeTransition {
  readonly from?: MarketRegime;
  readonly to: MarketRegime;
  readonly changed: boolean;
  readonly transitionConfidence: number;
  readonly observedAt: number;
}

export interface RegimeStrategyPolicy {
  readonly allowTrend: boolean;
  readonly allowMeanReversion: boolean;
  readonly allowFundingCarry: boolean;
  readonly allowNewExposure: boolean;
  readonly exposureMultiplier: number;
  readonly reasons: readonly string[];
}
