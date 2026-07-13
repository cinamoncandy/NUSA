import type { ProbabilityEstimate } from "./probabilityEngine";

export type TradePermissionDecision = "PERMIT" | "REJECT";

export type TradePermissionGateName =
  | "DATA_QUALITY"
  | "FRESHNESS"
  | "REGIME_COMPATIBILITY"
  | "PROBABILITY"
  | "EXPECTED_VALUE"
  | "REWARD_TO_RISK"
  | "LIQUIDITY"
  | "CAPACITY"
  | "SLIPPAGE"
  | "UNCERTAINTY"
  | "MODEL_AGREEMENT"
  | "RISK_BUDGET"
  | "KILL_SWITCH"
  | "GOVERNANCE";

export interface TradePermissionPolicy {
  readonly policyVersion: string;
  readonly minimumDataQuality: number;
  readonly maximumAgeMs: number;
  readonly compatibleRegimes: readonly string[];
  readonly minimumCalibratedProbability: number;
  readonly minimumNetExpectedValue: number;
  readonly minimumRewardToRisk: number;
  readonly minimumLiquidityScore: number;
  readonly minimumCapacityUsd: number;
  readonly maximumSlippageBps: number;
  readonly maximumUncertainty: number;
  readonly maximumModelDispersion: number;
  readonly maximumRiskBudgetUsage: number;
  readonly permissionTtlMs: number;
}

export interface TradePermissionInput {
  readonly decisionId: string;
  readonly strategyId: string;
  readonly market: string;
  readonly generatedAt: string;
  readonly probability: ProbabilityEstimate;
  readonly dataQuality: number;
  readonly sourceGeneratedAt: string;
  readonly regime: string;
  readonly netExpectedValue: number;
  readonly expectedReward: number;
  readonly expectedLoss: number;
  readonly liquidityScore: number;
  readonly capacityUsd: number;
  readonly estimatedSlippageBps: number;
  readonly modelProbabilities: readonly number[];
  readonly riskBudgetUsage: number;
  readonly killSwitchActive: boolean;
  readonly governanceApproved: boolean;
  readonly evidenceReferences: readonly string[];
}

export interface TradePermissionGateResult {
  readonly gate: TradePermissionGateName;
  readonly passed: boolean;
  readonly reason: string;
  readonly observedValue?: number | string | boolean;
  readonly threshold?: number | string | boolean;
}

export interface TradePermissionResult {
  readonly decisionId: string;
  readonly strategyId: string;
  readonly market: string;
  readonly decision: TradePermissionDecision;
  readonly passedGates: readonly TradePermissionGateName[];
  readonly failedGates: readonly TradePermissionGateName[];
  readonly gates: readonly TradePermissionGateResult[];
  readonly rejectionReasons: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly policyVersion: string;
  readonly probabilityModelVersion: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const requireProbability = (value: number, label: string): void => {
  requireFinite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};

const validatePolicy = (policy: TradePermissionPolicy): void => {
  if (!policy.policyVersion.trim()) throw new Error("policyVersion is required");
  requireProbability(policy.minimumDataQuality, "minimumDataQuality");
  requireProbability(policy.minimumCalibratedProbability, "minimumCalibratedProbability");
  requireProbability(policy.minimumLiquidityScore, "minimumLiquidityScore");
  requireProbability(policy.maximumUncertainty, "maximumUncertainty");
  requireProbability(policy.maximumModelDispersion, "maximumModelDispersion");
  requireProbability(policy.maximumRiskBudgetUsage, "maximumRiskBudgetUsage");
  requireFinite(policy.maximumAgeMs, "maximumAgeMs");
  requireFinite(policy.minimumNetExpectedValue, "minimumNetExpectedValue");
  requireFinite(policy.minimumRewardToRisk, "minimumRewardToRisk");
  requireFinite(policy.minimumCapacityUsd, "minimumCapacityUsd");
  requireFinite(policy.maximumSlippageBps, "maximumSlippageBps");
  requireFinite(policy.permissionTtlMs, "permissionTtlMs");
  if (policy.maximumAgeMs <= 0) throw new Error("maximumAgeMs must be positive");
  if (policy.minimumRewardToRisk <= 0) throw new Error("minimumRewardToRisk must be positive");
  if (policy.minimumCapacityUsd < 0) throw new Error("minimumCapacityUsd must be non-negative");
  if (policy.maximumSlippageBps < 0) throw new Error("maximumSlippageBps must be non-negative");
  if (policy.permissionTtlMs <= 0) throw new Error("permissionTtlMs must be positive");
  if (policy.compatibleRegimes.length === 0) throw new Error("compatibleRegimes cannot be empty");
  if (new Set(policy.compatibleRegimes).size !== policy.compatibleRegimes.length) {
    throw new Error("compatibleRegimes must be unique");
  }
};

const dispersion = (probabilities: readonly number[]): number => {
  if (probabilities.length < 2) return 1;
  for (const [index, probability] of probabilities.entries()) {
    requireProbability(probability, `modelProbabilities[${index}]`);
  }
  const mean = probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length;
  const variance = probabilities.reduce((sum, value) => sum + (value - mean) ** 2, 0) / probabilities.length;
  return Math.sqrt(variance);
};

const gate = (
  name: TradePermissionGateName,
  passed: boolean,
  reason: string,
  observedValue?: number | string | boolean,
  threshold?: number | string | boolean
): TradePermissionGateResult => Object.freeze({ gate: name, passed, reason, observedValue, threshold });

const freezeResult = (result: TradePermissionResult): TradePermissionResult => {
  for (const item of result.gates) Object.freeze(item);
  Object.freeze(result.gates);
  Object.freeze(result.passedGates);
  Object.freeze(result.failedGates);
  Object.freeze(result.rejectionReasons);
  Object.freeze(result.evidenceReferences);
  return Object.freeze(result);
};

export const evaluateTradePermission = (
  input: TradePermissionInput,
  policy: TradePermissionPolicy
): TradePermissionResult => {
  validatePolicy(policy);
  if (!input.decisionId.trim()) throw new Error("decisionId is required");
  if (!input.strategyId.trim()) throw new Error("strategyId is required");
  if (!input.market.trim()) throw new Error("market is required");
  if (input.market !== input.probability.market) throw new Error("probability market does not match permission market");
  if (input.evidenceReferences.length === 0) throw new Error("at least one evidence reference is required");
  if (new Set(input.evidenceReferences).size !== input.evidenceReferences.length) {
    throw new Error("evidence references must be unique");
  }

  requireProbability(input.dataQuality, "dataQuality");
  requireFinite(input.netExpectedValue, "netExpectedValue");
  requireFinite(input.expectedReward, "expectedReward");
  requireFinite(input.expectedLoss, "expectedLoss");
  requireProbability(input.liquidityScore, "liquidityScore");
  requireFinite(input.capacityUsd, "capacityUsd");
  requireFinite(input.estimatedSlippageBps, "estimatedSlippageBps");
  requireProbability(input.riskBudgetUsage, "riskBudgetUsage");
  if (input.expectedReward < 0) throw new Error("expectedReward must be non-negative");
  if (input.expectedLoss <= 0) throw new Error("expectedLoss must be positive");
  if (input.capacityUsd < 0) throw new Error("capacityUsd must be non-negative");
  if (input.estimatedSlippageBps < 0) throw new Error("estimatedSlippageBps must be non-negative");

  const generatedAt = parseTime(input.generatedAt, "generatedAt");
  const sourceGeneratedAt = parseTime(input.sourceGeneratedAt, "sourceGeneratedAt");
  const probabilityGeneratedAt = parseTime(input.probability.generatedAt, "probability.generatedAt");
  if (sourceGeneratedAt > generatedAt) throw new Error("source data cannot be generated in the future");
  if (probabilityGeneratedAt > generatedAt) throw new Error("probability cannot be generated in the future");

  const ageMs = generatedAt - Math.min(sourceGeneratedAt, probabilityGeneratedAt);
  const rewardToRisk = input.expectedReward / input.expectedLoss;
  const modelDispersion = dispersion(input.modelProbabilities);
  const probabilityCompatible = !input.probability.abstain;

  const gates: TradePermissionGateResult[] = [
    gate("DATA_QUALITY", input.dataQuality >= policy.minimumDataQuality, "data quality threshold", input.dataQuality, policy.minimumDataQuality),
    gate("FRESHNESS", ageMs <= policy.maximumAgeMs, "source and probability freshness", ageMs, policy.maximumAgeMs),
    gate("REGIME_COMPATIBILITY", policy.compatibleRegimes.includes(input.regime), "strategy regime compatibility", input.regime, policy.compatibleRegimes.join(",")),
    gate(
      "PROBABILITY",
      probabilityCompatible && input.probability.calibratedProbability >= policy.minimumCalibratedProbability,
      input.probability.abstain ? `probability abstained: ${input.probability.abstainReasons.join(",")}` : "calibrated probability threshold",
      input.probability.calibratedProbability,
      policy.minimumCalibratedProbability
    ),
    gate("EXPECTED_VALUE", input.netExpectedValue >= policy.minimumNetExpectedValue, "net expected value threshold", input.netExpectedValue, policy.minimumNetExpectedValue),
    gate("REWARD_TO_RISK", rewardToRisk >= policy.minimumRewardToRisk, "reward-to-risk threshold", rewardToRisk, policy.minimumRewardToRisk),
    gate("LIQUIDITY", input.liquidityScore >= policy.minimumLiquidityScore, "liquidity threshold", input.liquidityScore, policy.minimumLiquidityScore),
    gate("CAPACITY", input.capacityUsd >= policy.minimumCapacityUsd, "capacity threshold", input.capacityUsd, policy.minimumCapacityUsd),
    gate("SLIPPAGE", input.estimatedSlippageBps <= policy.maximumSlippageBps, "slippage budget", input.estimatedSlippageBps, policy.maximumSlippageBps),
    gate("UNCERTAINTY", clamp01(input.probability.uncertainty) <= policy.maximumUncertainty, "uncertainty limit", input.probability.uncertainty, policy.maximumUncertainty),
    gate("MODEL_AGREEMENT", modelDispersion <= policy.maximumModelDispersion, "model dispersion limit", modelDispersion, policy.maximumModelDispersion),
    gate("RISK_BUDGET", input.riskBudgetUsage <= policy.maximumRiskBudgetUsage, "risk budget usage limit", input.riskBudgetUsage, policy.maximumRiskBudgetUsage),
    gate("KILL_SWITCH", input.killSwitchActive === false, "kill switch must be inactive", input.killSwitchActive, false),
    gate("GOVERNANCE", input.governanceApproved === true, "strategy governance approval", input.governanceApproved, true)
  ];

  const failedGates = gates.filter((item) => !item.passed).map((item) => item.gate);
  const passedGates = gates.filter((item) => item.passed).map((item) => item.gate);
  const rejectionReasons = gates.filter((item) => !item.passed).map((item) => `${item.gate}:${item.reason}`);
  const decision: TradePermissionDecision = failedGates.length === 0 ? "PERMIT" : "REJECT";

  return freezeResult({
    decisionId: input.decisionId,
    strategyId: input.strategyId,
    market: input.market,
    decision,
    passedGates: Object.freeze(passedGates),
    failedGates: Object.freeze(failedGates),
    gates: Object.freeze(gates),
    rejectionReasons: Object.freeze(rejectionReasons),
    evidenceReferences: Object.freeze([...input.evidenceReferences]),
    policyVersion: policy.policyVersion,
    probabilityModelVersion: input.probability.modelVersion,
    generatedAt: input.generatedAt,
    expiresAt: new Date(generatedAt + policy.permissionTtlMs).toISOString()
  });
};
