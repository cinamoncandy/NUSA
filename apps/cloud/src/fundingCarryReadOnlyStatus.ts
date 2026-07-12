import type { HedgeState } from "./atomicHedgeCoordinator";

export interface FundingCarryReadOnlyStatusInput {
  readonly expectedAnnualizedFundingRate: number;
  readonly netCarry: number;
  readonly currentDelta: number;
  readonly hedgeState: HedgeState;
  readonly liquidationBufferBps: number;
  readonly nextFundingAt: number;
  readonly generatedAt: number;
}

export interface FundingCarryReadOnlyStatus {
  readonly expectedAnnualizedFundingRate: number;
  readonly netCarry: number;
  readonly currentDelta: number;
  readonly hedgeState: HedgeState;
  readonly liquidationBufferBps: number;
  readonly nextFundingAt: number;
  readonly generatedAt: number;
}

export function buildFundingCarryReadOnlyStatus(input: FundingCarryReadOnlyStatusInput): FundingCarryReadOnlyStatus {
  for (const [field, value] of Object.entries({
    expectedAnnualizedFundingRate: input.expectedAnnualizedFundingRate,
    netCarry: input.netCarry,
    currentDelta: input.currentDelta,
    liquidationBufferBps: input.liquidationBufferBps
  })) if (!Number.isFinite(value)) throw new Error(`${field} is invalid`);
  for (const [field, value] of Object.entries({ nextFundingAt: input.nextFundingAt, generatedAt: input.generatedAt })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is invalid`);
  }
  if (input.nextFundingAt < input.generatedAt) throw new Error("nextFundingAt is invalid");
  return Object.freeze({ ...input });
}
