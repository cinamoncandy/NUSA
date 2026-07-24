import type { FundingPersistenceFeatureVector } from "./FundingPersistenceFeature";

export type FundingPersistencePosition = "FLAT" | "LONG" | "SHORT";
export type FundingPersistenceAction = "ENTER_LONG" | "ENTER_SHORT" | "EXIT" | "HOLD" | "ABSTAIN";

export interface FundingPersistenceStrategyPolicy {
  readonly strategyVersion: number;
  readonly minimumFeatureVersion: number;
  readonly minimumQuality: number;
  readonly minimumAbsoluteZScore: number;
  readonly minimumPersistenceSamples: number;
  readonly minimumPersistenceRatio: number;
  readonly minimumOpenInterestDelta: number;
  readonly maximumAbsoluteBasisRate: number;
  readonly maximumFeatureAgeMs: number;
  readonly exitAbsoluteZScore: number;
}

export interface FundingPersistenceStrategyInput {
  readonly decisionId: string;
  readonly generatedAt: string;
  readonly currentPosition: FundingPersistencePosition;
  readonly feature: FundingPersistenceFeatureVector;
}

export interface FundingPersistenceStrategyDecision {
  readonly decisionId: string;
  readonly strategyId: "FUNDING_PERSISTENCE_MEAN_REVERSION";
  readonly strategyVersion: number;
  readonly market: string;
  readonly generatedAt: string;
  readonly action: FundingPersistenceAction;
  readonly targetPosition: FundingPersistencePosition;
  readonly signalStrength: number;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly featureVersion: number;
  readonly featureGeneratedAt: string;
  readonly featureProvenance: readonly string[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const validatePolicy = (policy: FundingPersistenceStrategyPolicy): void => {
  if (!Number.isInteger(policy.strategyVersion) || policy.strategyVersion < 1) throw new Error("strategyVersion must be a positive integer");
  if (!Number.isInteger(policy.minimumFeatureVersion) || policy.minimumFeatureVersion < 1) throw new Error("minimumFeatureVersion must be a positive integer");
  for (const [label, value] of [
    ["minimumQuality", policy.minimumQuality],
    ["minimumPersistenceRatio", policy.minimumPersistenceRatio]
  ] as const) {
    requireFinite(value, label);
    if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
  }
  requireFinite(policy.minimumAbsoluteZScore, "minimumAbsoluteZScore");
  requireFinite(policy.minimumOpenInterestDelta, "minimumOpenInterestDelta");
  requireFinite(policy.maximumAbsoluteBasisRate, "maximumAbsoluteBasisRate");
  requireFinite(policy.maximumFeatureAgeMs, "maximumFeatureAgeMs");
  requireFinite(policy.exitAbsoluteZScore, "exitAbsoluteZScore");
  if (policy.minimumAbsoluteZScore <= 0) throw new Error("minimumAbsoluteZScore must be positive");
  if (!Number.isInteger(policy.minimumPersistenceSamples) || policy.minimumPersistenceSamples < 1) throw new Error("minimumPersistenceSamples must be a positive integer");
  if (policy.minimumOpenInterestDelta < 0) throw new Error("minimumOpenInterestDelta must be non-negative");
  if (policy.maximumAbsoluteBasisRate < 0) throw new Error("maximumAbsoluteBasisRate must be non-negative");
  if (policy.maximumFeatureAgeMs <= 0) throw new Error("maximumFeatureAgeMs must be positive");
  if (policy.exitAbsoluteZScore < 0 || policy.exitAbsoluteZScore >= policy.minimumAbsoluteZScore) {
    throw new Error("exitAbsoluteZScore must be non-negative and below minimumAbsoluteZScore");
  }
};

const freezeDecision = (decision: FundingPersistenceStrategyDecision): FundingPersistenceStrategyDecision => {
  Object.freeze(decision.reasons);
  Object.freeze(decision.featureProvenance);
  return Object.freeze(decision);
};

export const evaluateFundingPersistenceStrategy = (
  input: FundingPersistenceStrategyInput,
  policy: FundingPersistenceStrategyPolicy
): FundingPersistenceStrategyDecision => {
  validatePolicy(policy);
  if (!input.decisionId.trim()) throw new Error("decisionId is required");
  if (!new Set<FundingPersistencePosition>(["FLAT", "LONG", "SHORT"]).has(input.currentPosition)) throw new Error("invalid currentPosition");
  const decisionTime = parseTime(input.generatedAt, "generatedAt");
  const featureTime = parseTime(input.feature.generatedAt, "feature.generatedAt");
  if (featureTime > decisionTime) throw new Error("feature cannot be generated in the future");
  if (input.feature.sourceEndAt > input.feature.generatedAt) throw new Error("feature sourceEndAt cannot follow feature generatedAt");

  const reasons: string[] = [];
  const featureAge = decisionTime - featureTime;
  if (featureAge > policy.maximumFeatureAgeMs) reasons.push("FEATURE_STALE");
  if (input.feature.featureVersion < policy.minimumFeatureVersion) reasons.push("FEATURE_VERSION_UNSUPPORTED");
  if (input.feature.quality < policy.minimumQuality) reasons.push("FEATURE_QUALITY_LOW");
  if (input.feature.warnings.length > 0) reasons.push("FEATURE_WARNINGS_PRESENT");
  if (Math.abs(input.feature.fundingZScore) < policy.minimumAbsoluteZScore) reasons.push("Z_SCORE_NOT_EXTREME");
  if (input.feature.persistenceSamples < policy.minimumPersistenceSamples) reasons.push("PERSISTENCE_TOO_SHORT");
  if (input.feature.persistenceRatio < policy.minimumPersistenceRatio) reasons.push("PERSISTENCE_RATIO_LOW");
  if (input.feature.openInterestDelta < policy.minimumOpenInterestDelta) reasons.push("OPEN_INTEREST_CONFIRMATION_FAILED");
  if (Math.abs(input.feature.basisRate) > policy.maximumAbsoluteBasisRate) reasons.push("BASIS_TOO_WIDE");
  if (input.feature.direction === "NEUTRAL") reasons.push("FEATURE_DIRECTION_NEUTRAL");

  const shouldExit = input.currentPosition !== "FLAT" && Math.abs(input.feature.fundingZScore) <= policy.exitAbsoluteZScore;
  if (shouldExit) {
    return freezeDecision({
      decisionId: input.decisionId.trim(),
      strategyId: "FUNDING_PERSISTENCE_MEAN_REVERSION",
      strategyVersion: policy.strategyVersion,
      market: input.feature.market,
      generatedAt: input.generatedAt,
      action: "EXIT",
      targetPosition: "FLAT",
      signalStrength: 0,
      eligible: true,
      reasons: Object.freeze(["MEAN_REVERSION_EXIT_THRESHOLD_REACHED"]),
      featureVersion: input.feature.featureVersion,
      featureGeneratedAt: input.feature.generatedAt,
      featureProvenance: Object.freeze([...input.feature.provenance])
    });
  }

  const eligible = reasons.length === 0;
  if (!eligible) {
    return freezeDecision({
      decisionId: input.decisionId.trim(),
      strategyId: "FUNDING_PERSISTENCE_MEAN_REVERSION",
      strategyVersion: policy.strategyVersion,
      market: input.feature.market,
      generatedAt: input.generatedAt,
      action: "ABSTAIN",
      targetPosition: input.currentPosition,
      signalStrength: 0,
      eligible: false,
      reasons: Object.freeze(reasons),
      featureVersion: input.feature.featureVersion,
      featureGeneratedAt: input.feature.generatedAt,
      featureProvenance: Object.freeze([...input.feature.provenance])
    });
  }

  const targetPosition: FundingPersistencePosition = input.feature.direction === "POSITIVE" ? "SHORT" : "LONG";
  const samePosition = input.currentPosition === targetPosition;
  const signalStrength = round(clamp01(
    0.4 * Math.min(1, Math.abs(input.feature.fundingZScore) / (policy.minimumAbsoluteZScore * 2))
    + 0.3 * Math.min(1, input.feature.persistenceRatio / Math.max(policy.minimumPersistenceRatio, 1e-9))
    + 0.2 * input.feature.quality
    + 0.1 * Math.min(1, input.feature.openInterestDelta / Math.max(policy.minimumOpenInterestDelta, 1e-9))
  ));

  return freezeDecision({
    decisionId: input.decisionId.trim(),
    strategyId: "FUNDING_PERSISTENCE_MEAN_REVERSION",
    strategyVersion: policy.strategyVersion,
    market: input.feature.market,
    generatedAt: input.generatedAt,
    action: samePosition ? "HOLD" : targetPosition === "LONG" ? "ENTER_LONG" : "ENTER_SHORT",
    targetPosition,
    signalStrength,
    eligible: true,
    reasons: Object.freeze([samePosition ? "POSITION_ALREADY_ALIGNED" : "EXTREME_PERSISTENT_FUNDING_CONFIRMED"]),
    featureVersion: input.feature.featureVersion,
    featureGeneratedAt: input.feature.generatedAt,
    featureProvenance: Object.freeze([...input.feature.provenance])
  });
};
