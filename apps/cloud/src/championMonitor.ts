import type { EdgeDecayResult } from "./edgeDecayMonitor";

export type ChampionLifecycle = "PAPER" | "SCALING" | "CHAMPION" | "SUSPENDED" | "RETIRED";
export type ChampionRecommendation =
  | "MAINTAIN"
  | "OBSERVE"
  | "REDUCE_CAPITAL"
  | "ROLLBACK_TO_PAPER"
  | "SUSPEND";

export interface ChampionMonitorPolicy {
  readonly policyVersion: string;
  readonly minimumEvidenceScore: number;
  readonly maximumCalibrationError: number;
  readonly maximumDrawdown: number;
  readonly maximumRiskBreaches: number;
  readonly orangeCapitalMultiplier: number;
  readonly yellowCapitalMultiplier: number;
}

export interface ChampionMonitorInput {
  readonly reviewId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly lifecycle: ChampionLifecycle;
  readonly generatedAt: string;
  readonly edgeDecay: EdgeDecayResult;
  readonly evidenceScore: number;
  readonly calibrationError: number;
  readonly currentDrawdown: number;
  readonly riskBreachCount: number;
  readonly governanceApproved: boolean;
  readonly activeCriticalIncident: boolean;
  readonly currentCapitalFraction: number;
  readonly evidenceReferences: readonly string[];
}

export interface ChampionMonitorResult {
  readonly reviewId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly lifecycle: ChampionLifecycle;
  readonly recommendation: ChampionRecommendation;
  readonly recommendedLifecycle: ChampionLifecycle;
  readonly recommendedCapitalFraction: number;
  readonly reasons: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly edgeDecayStatus: EdgeDecayResult["status"];
  readonly edgeDecayScore: number;
  readonly policyVersion: string;
  readonly generatedAt: string;
  readonly requiresHumanApproval: true;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const probability = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};

const validatePolicy = (policy: ChampionMonitorPolicy): void => {
  if (!policy.policyVersion.trim()) throw new Error("policyVersion is required");
  probability(policy.minimumEvidenceScore, "minimumEvidenceScore");
  probability(policy.maximumCalibrationError, "maximumCalibrationError");
  probability(policy.maximumDrawdown, "maximumDrawdown");
  probability(policy.orangeCapitalMultiplier, "orangeCapitalMultiplier");
  probability(policy.yellowCapitalMultiplier, "yellowCapitalMultiplier");
  if (!Number.isInteger(policy.maximumRiskBreaches) || policy.maximumRiskBreaches < 0) {
    throw new Error("maximumRiskBreaches must be a non-negative integer");
  }
  if (policy.orangeCapitalMultiplier > policy.yellowCapitalMultiplier) {
    throw new Error("orangeCapitalMultiplier cannot exceed yellowCapitalMultiplier");
  }
};

const freezeResult = (result: ChampionMonitorResult): ChampionMonitorResult => {
  Object.freeze(result.reasons);
  Object.freeze(result.evidenceReferences);
  return Object.freeze(result);
};

export const evaluateChampion = (
  input: ChampionMonitorInput,
  policy: ChampionMonitorPolicy
): ChampionMonitorResult => {
  validatePolicy(policy);
  if (!input.reviewId.trim()) throw new Error("reviewId is required");
  if (!input.strategyId.trim()) throw new Error("strategyId is required");
  if (!input.strategyVersion.trim()) throw new Error("strategyVersion is required");
  probability(input.evidenceScore, "evidenceScore");
  probability(input.calibrationError, "calibrationError");
  probability(input.currentDrawdown, "currentDrawdown");
  probability(input.currentCapitalFraction, "currentCapitalFraction");
  if (!Number.isInteger(input.riskBreachCount) || input.riskBreachCount < 0) {
    throw new Error("riskBreachCount must be a non-negative integer");
  }
  if (input.evidenceReferences.length === 0) throw new Error("evidenceReferences cannot be empty");
  if (new Set(input.evidenceReferences).size !== input.evidenceReferences.length) {
    throw new Error("evidenceReferences must be unique");
  }

  const generatedAt = parseTime(input.generatedAt, "generatedAt");
  const decayGeneratedAt = parseTime(input.edgeDecay.generatedAt, "edgeDecay.generatedAt");
  if (decayGeneratedAt > generatedAt) throw new Error("edge decay result cannot be generated in the future");
  if (input.edgeDecay.edgeId !== input.strategyId || input.edgeDecay.edgeVersion !== input.strategyVersion) {
    throw new Error("edge decay identity does not match strategy identity");
  }

  const reasons: string[] = [];
  if (!input.governanceApproved) reasons.push("GOVERNANCE_APPROVAL_MISSING");
  if (input.activeCriticalIncident) reasons.push("ACTIVE_CRITICAL_INCIDENT");
  if (input.riskBreachCount > policy.maximumRiskBreaches) reasons.push("RISK_BREACH_LIMIT_EXCEEDED");
  if (input.evidenceScore < policy.minimumEvidenceScore) reasons.push("EVIDENCE_SCORE_BELOW_MINIMUM");
  if (input.calibrationError > policy.maximumCalibrationError) reasons.push("CALIBRATION_ERROR_EXCEEDED");
  if (input.currentDrawdown > policy.maximumDrawdown) reasons.push("DRAWDOWN_LIMIT_EXCEEDED");
  if (input.edgeDecay.status !== "GREEN") reasons.push(`EDGE_DECAY_${input.edgeDecay.status}`);

  let recommendation: ChampionRecommendation = "MAINTAIN";
  let recommendedLifecycle: ChampionLifecycle = input.lifecycle;
  let capitalMultiplier = 1;

  const hardSuspend = !input.governanceApproved
    || input.activeCriticalIncident
    || input.riskBreachCount > policy.maximumRiskBreaches;
  const rollback = input.edgeDecay.status === "RED"
    || input.evidenceScore < policy.minimumEvidenceScore
    || input.calibrationError > policy.maximumCalibrationError
    || input.currentDrawdown > policy.maximumDrawdown;

  if (input.lifecycle !== "CHAMPION") {
    recommendation = "OBSERVE";
    capitalMultiplier = 0;
    reasons.push("LIFECYCLE_NOT_CHAMPION");
  } else if (hardSuspend) {
    recommendation = "SUSPEND";
    recommendedLifecycle = "SUSPENDED";
    capitalMultiplier = 0;
  } else if (rollback) {
    recommendation = "ROLLBACK_TO_PAPER";
    recommendedLifecycle = "PAPER";
    capitalMultiplier = 0;
  } else if (input.edgeDecay.status === "ORANGE") {
    recommendation = "REDUCE_CAPITAL";
    capitalMultiplier = policy.orangeCapitalMultiplier;
  } else if (input.edgeDecay.status === "YELLOW") {
    recommendation = "OBSERVE";
    capitalMultiplier = policy.yellowCapitalMultiplier;
  }

  return freezeResult({
    reviewId: input.reviewId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    lifecycle: input.lifecycle,
    recommendation,
    recommendedLifecycle,
    recommendedCapitalFraction: round(clamp01(input.currentCapitalFraction * capitalMultiplier)),
    reasons: Object.freeze(reasons),
    evidenceReferences: Object.freeze([...input.evidenceReferences]),
    edgeDecayStatus: input.edgeDecay.status,
    edgeDecayScore: input.edgeDecay.decayScore,
    policyVersion: policy.policyVersion,
    generatedAt: input.generatedAt,
    requiresHumanApproval: true
  });
};
