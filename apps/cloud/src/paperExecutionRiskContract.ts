import { createHash } from "node:crypto";
import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";

const round8 = (value: number): number => Number(value.toFixed(8));
const SHA256 = /^[a-f0-9]{64}$/;

export type PaperExecutionRiskContractDecision = "ALLOW" | "ABSTAIN";

export interface PaperExecutionRiskContract {
  readonly schemaVersion: 1;
  readonly model: "EXPECTANCY_POSITION_RISK_V1";
  readonly ruinModel: "IID_FIXED_FRACTION_LOSS_STREAK_UNION_BOUND_V1";
  readonly decision: PaperExecutionRiskContractDecision;
  readonly reasons: readonly string[];
  readonly entryPrice: number;
  readonly accountEquity: number;
  readonly allocationCapital: number;
  readonly winProbability: number;
  readonly averageWinReturn: number;
  readonly averageLossReturn: number;
  readonly expectedValueReturn: number;
  readonly rewardRiskRatio: number;
  readonly riskPerTradeFraction: number;
  readonly maximumLossCapital: number;
  readonly stopLossFraction: number;
  readonly atrFraction: number;
  readonly atrMultiplier: number;
  readonly effectiveStopFraction: number;
  readonly stopDistance: number;
  readonly riskSizedQuantity: number;
  readonly allocationLimitedQuantity: number;
  readonly allowedQuantity: number;
  readonly minimumRewardRisk: number;
  readonly ruinDrawdownFraction: number;
  readonly ruinHorizonTrades: number;
  readonly ruinLossStreakTrades: number;
  readonly ruinRiskUpperBound: number;
  readonly maximumRuinProbability: number;
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly fingerprintSha256: string;
}

export interface PaperExecutionRiskContractInput {
  readonly entryPrice: number;
  readonly accountEquity: number;
  readonly allocationCapital: number;
  readonly winProbability: number;
  readonly averageWinReturn: number;
  readonly averageLossReturn: number;
  readonly riskPerTradeFraction: number;
  readonly stopLossFraction: number;
  readonly atrFraction: number;
  readonly atrMultiplier: number;
  readonly minimumRewardRisk: number;
  readonly ruinDrawdownFraction: number;
  readonly ruinHorizonTrades: number;
  readonly maximumRuinProbability: number;
}

const PARAMETER_KEYS = Object.freeze([
  "riskWinProbability",
  "riskAverageWinReturn",
  "riskAverageLossReturn",
  "riskPerTradeFraction",
  "riskStopLossFraction",
  "riskAtrFraction",
  "riskAtrMultiplier",
  "riskMinimumRewardRisk",
  "riskRuinDrawdownFraction",
  "riskRuinHorizonTrades",
  "riskMaximumRuinProbability",
] as const);

const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`PAPER_EXECUTION_RISK_${field.toUpperCase()}_INVALID`);
  return value;
}

function unitExclusiveZero(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`PAPER_EXECUTION_RISK_${field.toUpperCase()}_INVALID`);
  return value;
}

function unit(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`PAPER_EXECUTION_RISK_${field.toUpperCase()}_INVALID`);
  return value;
}

function canonicalWithoutFingerprint(contract: Omit<PaperExecutionRiskContract, "fingerprintSha256">) {
  return contract;
}

export function buildPaperExecutionRiskContract(input: PaperExecutionRiskContractInput): PaperExecutionRiskContract {
  const entryPrice = positive(input.entryPrice, "entry_price");
  const accountEquity = positive(input.accountEquity, "account_equity");
  const allocationCapital = positive(input.allocationCapital, "allocation_capital");
  const winProbability = unitExclusiveZero(input.winProbability, "win_probability");
  const averageWinReturn = positive(input.averageWinReturn, "average_win_return");
  const averageLossReturn = positive(input.averageLossReturn, "average_loss_return");
  const riskPerTradeFraction = unitExclusiveZero(input.riskPerTradeFraction, "risk_per_trade_fraction");
  const stopLossFraction = unitExclusiveZero(input.stopLossFraction, "stop_loss_fraction");
  const atrFraction = unit(input.atrFraction, "atr_fraction");
  const atrMultiplier = positive(input.atrMultiplier, "atr_multiplier");
  const minimumRewardRisk = positive(input.minimumRewardRisk, "minimum_reward_risk");
  const ruinDrawdownFraction = unitExclusiveZero(input.ruinDrawdownFraction, "ruin_drawdown_fraction");
  if (!Number.isSafeInteger(input.ruinHorizonTrades) || input.ruinHorizonTrades <= 0) throw new Error("PAPER_EXECUTION_RISK_RUIN_HORIZON_TRADES_INVALID");
  const maximumRuinProbability = unit(input.maximumRuinProbability, "maximum_ruin_probability");

  const expectedValueReturn = round8(winProbability * averageWinReturn - (1 - winProbability) * averageLossReturn);
  const rewardRiskRatio = round8(averageWinReturn / averageLossReturn);
  const maximumLossCapital = round8(accountEquity * riskPerTradeFraction);
  const effectiveStopFraction = round8(Math.max(stopLossFraction, atrFraction * atrMultiplier));
  const stopDistance = round8(entryPrice * effectiveStopFraction);
  const riskSizedQuantity = round8(maximumLossCapital / stopDistance);
  const allocationLimitedQuantity = round8(allocationCapital / entryPrice);
  const allowedQuantity = round8(Math.min(riskSizedQuantity, allocationLimitedQuantity));

  const lossProbability = 1 - winProbability;
  const ruinLossStreakTrades = Math.max(1, Math.ceil(Math.log(1 - ruinDrawdownFraction) / Math.log(1 - riskPerTradeFraction)));
  const possibleStarts = Math.max(0, input.ruinHorizonTrades - ruinLossStreakTrades + 1);
  const ruinRiskUpperBound = round8(Math.min(1, possibleStarts * Math.pow(lossProbability, ruinLossStreakTrades)));

  const reasons: string[] = [];
  if (expectedValueReturn <= 0) reasons.push("NON_POSITIVE_EXPECTANCY");
  if (rewardRiskRatio < minimumRewardRisk) reasons.push("REWARD_RISK_BELOW_MINIMUM");
  if (ruinRiskUpperBound > maximumRuinProbability) reasons.push("RUIN_RISK_LIMIT_EXCEEDED");
  if (!Number.isFinite(allowedQuantity) || allowedQuantity <= 0) reasons.push("POSITION_SIZE_ZERO");

  const base: Omit<PaperExecutionRiskContract, "fingerprintSha256"> = Object.freeze({
    schemaVersion: 1,
    model: "EXPECTANCY_POSITION_RISK_V1",
    ruinModel: "IID_FIXED_FRACTION_LOSS_STREAK_UNION_BOUND_V1",
    decision: reasons.length === 0 ? "ALLOW" : "ABSTAIN",
    reasons: Object.freeze([...reasons].sort()),
    entryPrice,
    accountEquity,
    allocationCapital,
    winProbability,
    averageWinReturn,
    averageLossReturn,
    expectedValueReturn,
    rewardRiskRatio,
    riskPerTradeFraction,
    maximumLossCapital,
    stopLossFraction,
    atrFraction,
    atrMultiplier,
    effectiveStopFraction,
    stopDistance,
    riskSizedQuantity,
    allocationLimitedQuantity,
    allowedQuantity,
    minimumRewardRisk,
    ruinDrawdownFraction,
    ruinHorizonTrades: input.ruinHorizonTrades,
    ruinLossStreakTrades,
    ruinRiskUpperBound,
    maximumRuinProbability,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
  return Object.freeze({ ...base, fingerprintSha256: fingerprint(canonicalWithoutFingerprint(base)) });
}

export function validatePaperExecutionRiskContract(contract: PaperExecutionRiskContract): PaperExecutionRiskContract {
  if (contract.schemaVersion !== 1 || contract.model !== "EXPECTANCY_POSITION_RISK_V1" ||
      contract.ruinModel !== "IID_FIXED_FRACTION_LOSS_STREAK_UNION_BOUND_V1" ||
      contract.authority !== "PAPER_ONLY" || contract.liveAuthority !== "NONE" ||
      contract.productionMutationAllowed !== false || contract.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("PAPER_EXECUTION_RISK_AUTHORITY_INVALID");
  }
  const rebuilt = buildPaperExecutionRiskContract({
    entryPrice: contract.entryPrice,
    accountEquity: contract.accountEquity,
    allocationCapital: contract.allocationCapital,
    winProbability: contract.winProbability,
    averageWinReturn: contract.averageWinReturn,
    averageLossReturn: contract.averageLossReturn,
    riskPerTradeFraction: contract.riskPerTradeFraction,
    stopLossFraction: contract.stopLossFraction,
    atrFraction: contract.atrFraction,
    atrMultiplier: contract.atrMultiplier,
    minimumRewardRisk: contract.minimumRewardRisk,
    ruinDrawdownFraction: contract.ruinDrawdownFraction,
    ruinHorizonTrades: contract.ruinHorizonTrades,
    maximumRuinProbability: contract.maximumRuinProbability,
  });
  if (!SHA256.test(contract.fingerprintSha256) || JSON.stringify(rebuilt) !== JSON.stringify(contract)) {
    throw new Error("PAPER_EXECUTION_RISK_FINGERPRINT_MISMATCH");
  }
  return contract;
}

function parameterNumber(parameters: Readonly<Record<string, string | number | boolean>>, key: typeof PARAMETER_KEYS[number]): number {
  const value = parameters[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("PAPER_EXECUTION_RISK_CANDIDATE_PARAMETERS_INVALID");
  return value;
}

export function buildPaperExecutionRiskContractFromCandidate(
  strategy: PaperCandidateStrategySpec | undefined,
  context: Readonly<{ entryPrice: number; accountEquity: number; allocationCapital: number }>,
): PaperExecutionRiskContract | null {
  if (strategy == null) return null;
  const parameters = strategy.parameters;
  const present = PARAMETER_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(parameters, key));
  if (present.length === 0) return null;
  if (present.length !== PARAMETER_KEYS.length) throw new Error("PAPER_EXECUTION_RISK_CANDIDATE_PARAMETERS_INCOMPLETE");
  return buildPaperExecutionRiskContract({
    entryPrice: context.entryPrice,
    accountEquity: context.accountEquity,
    allocationCapital: context.allocationCapital,
    winProbability: parameterNumber(parameters, "riskWinProbability"),
    averageWinReturn: parameterNumber(parameters, "riskAverageWinReturn"),
    averageLossReturn: parameterNumber(parameters, "riskAverageLossReturn"),
    riskPerTradeFraction: parameterNumber(parameters, "riskPerTradeFraction"),
    stopLossFraction: parameterNumber(parameters, "riskStopLossFraction"),
    atrFraction: parameterNumber(parameters, "riskAtrFraction"),
    atrMultiplier: parameterNumber(parameters, "riskAtrMultiplier"),
    minimumRewardRisk: parameterNumber(parameters, "riskMinimumRewardRisk"),
    ruinDrawdownFraction: parameterNumber(parameters, "riskRuinDrawdownFraction"),
    ruinHorizonTrades: parameterNumber(parameters, "riskRuinHorizonTrades"),
    maximumRuinProbability: parameterNumber(parameters, "riskMaximumRuinProbability"),
  });
}
