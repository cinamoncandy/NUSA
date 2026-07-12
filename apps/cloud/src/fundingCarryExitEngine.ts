import { guardCapitalAllocation } from "../../mobile/src/capitalAllocationGuard";
import { protectWithdrawalCapital, type TreasuryState } from "../../mobile/src/withdrawalReservation";

export interface FundingCarryEntrySafetyInput {
  readonly mode: "PAPER" | "DRY_RUN" | "LIVE";
  readonly killSwitchActive: boolean;
  readonly treasury: TreasuryState;
  readonly requestedCapital: number;
}

export interface FundingCarryEntrySafetyResult {
  readonly allowed: boolean;
  readonly deployableCapital: number;
  readonly reservedWithdrawalCapital: number;
  readonly reasons: readonly string[];
}

export interface FundingCarryExitInput {
  readonly now: number;
  readonly fundingRate: number;
  readonly minimumFundingRate: number;
  readonly fundingDirection: "SHORT_RECEIVES" | "SHORT_PAYS" | "UNKNOWN";
  readonly netCarry: number;
  readonly basisBps: number;
  readonly maximumBasisBps: number;
  readonly liquidityScore: number;
  readonly minimumLiquidityScore: number;
  readonly liquidationBufferBps: number;
  readonly minimumLiquidationBufferBps: number;
  readonly killSwitchActive: boolean;
  readonly deployableCapital: number;
  readonly requiredCapital: number;
  readonly spotBaseQuantity: number;
  readonly perpetualShortBaseQuantity: number;
  readonly maximumTurnoverFraction: number;
}

export interface FundingCarryExitPlan {
  readonly action: "HOLD" | "GRADUAL_EXIT" | "EMERGENCY_EXIT";
  readonly spotReduceQuantity: number;
  readonly perpetualReduceQuantity: number;
  readonly reasons: readonly string[];
  readonly plannedAt: number;
}

const finite = (value: number, field: string, minimum = 0): void => {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${field} is invalid`);
};
const time = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("now is invalid");
};
const round8 = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;

export function assessFundingCarryEntrySafety(input: FundingCarryEntrySafetyInput): FundingCarryEntrySafetyResult {
  finite(input.requestedCapital, "requestedCapital", Number.EPSILON);
  const protectedTreasury = protectWithdrawalCapital(input.treasury);
  const reasons: string[] = [];
  if (input.mode !== "PAPER" && input.mode !== "DRY_RUN") reasons.push("PAPER_OR_DRY_RUN_REQUIRED");
  if (input.killSwitchActive) reasons.push("KILL_SWITCH_ACTIVE");
  try {
    guardCapitalAllocation(protectedTreasury, [{ id: "funding-carry-entry", bucket: "FUTURES", amount: input.requestedCapital }]);
  } catch {
    reasons.push("WITHDRAWAL_RESERVED_CAPITAL_OR_ALLOCATION_LIMIT");
  }
  return Object.freeze({
    allowed: reasons.length === 0,
    deployableCapital: protectedTreasury.deployableCapital,
    reservedWithdrawalCapital: protectedTreasury.reservedWithdrawalCapital,
    reasons: Object.freeze(reasons.sort())
  });
}

export function planFundingCarryExit(input: FundingCarryExitInput): FundingCarryExitPlan {
  time(input.now);
  for (const [field, value] of Object.entries({
    minimumFundingRate: input.minimumFundingRate,
    basisBps: input.basisBps,
    maximumBasisBps: input.maximumBasisBps,
    liquidityScore: input.liquidityScore,
    minimumLiquidityScore: input.minimumLiquidityScore,
    liquidationBufferBps: input.liquidationBufferBps,
    minimumLiquidationBufferBps: input.minimumLiquidationBufferBps,
    deployableCapital: input.deployableCapital,
    requiredCapital: input.requiredCapital,
    spotBaseQuantity: input.spotBaseQuantity,
    perpetualShortBaseQuantity: input.perpetualShortBaseQuantity,
    maximumTurnoverFraction: input.maximumTurnoverFraction
  })) finite(value, field);
  if (!Number.isFinite(input.fundingRate) || !Number.isFinite(input.netCarry) || input.maximumTurnoverFraction > 1 || input.liquidityScore > 1 || input.minimumLiquidityScore > 1) throw new Error("exit input is invalid");

  const reasons: string[] = [];
  if (input.fundingRate < input.minimumFundingRate) reasons.push("FUNDING_BELOW_MINIMUM");
  if (input.fundingDirection !== "SHORT_RECEIVES") reasons.push("FUNDING_REVERSED_OR_UNCERTAIN");
  if (input.netCarry < 0) reasons.push("NEGATIVE_NET_CARRY");
  if (input.basisBps > input.maximumBasisBps) reasons.push("BASIS_TOO_WIDE");
  if (input.liquidityScore < input.minimumLiquidityScore) reasons.push("LIQUIDITY_LOW");
  if (input.liquidationBufferBps < input.minimumLiquidationBufferBps) reasons.push("LIQUIDATION_BUFFER_LOW");
  if (input.deployableCapital < input.requiredCapital) reasons.push("WITHDRAWAL_RESERVATION_REDUCED_CAPITAL");
  if (input.killSwitchActive) reasons.push("KILL_SWITCH_ACTIVE");
  const emergency = reasons.some((reason) => ["FUNDING_REVERSED_OR_UNCERTAIN", "LIQUIDATION_BUFFER_LOW", "KILL_SWITCH_ACTIVE"].includes(reason));
  const action: FundingCarryExitPlan["action"] = reasons.length === 0 ? "HOLD" : emergency ? "EMERGENCY_EXIT" : "GRADUAL_EXIT";
  const fraction = action === "HOLD" ? 0 : action === "EMERGENCY_EXIT" ? 1 : input.maximumTurnoverFraction;
  return Object.freeze({
    action,
    spotReduceQuantity: round8(input.spotBaseQuantity * fraction),
    perpetualReduceQuantity: round8(input.perpetualShortBaseQuantity * fraction),
    reasons: Object.freeze(reasons.sort()),
    plannedAt: input.now
  });
}
