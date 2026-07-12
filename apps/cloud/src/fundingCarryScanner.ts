import type { SpotPerpetualPair } from "./exchangeSymbolResolver";

export type FundingPayoutDirection = "SHORT_RECEIVES" | "SHORT_PAYS" | "UNKNOWN";

export interface FundingCarryMarketInput {
  readonly pair: SpotPerpetualPair;
  readonly fundingRate: number;
  readonly fundingObservedAt: number;
  readonly nextFundingAt: number;
  readonly fundingDirection: FundingPayoutDirection;
  readonly notional: number;
  readonly spotEntryFeeBps: number;
  readonly spotExitFeeBps: number;
  readonly perpetualEntryFeeBps: number;
  readonly perpetualExitFeeBps: number;
  readonly expectedSlippageBps: number;
  readonly basisRiskPremiumBps: number;
  readonly partialFillRiskPremiumBps: number;
  readonly capitalCostBps: number;
  readonly liquidityScore: number;
  readonly confidence: number;
}

export interface FundingCarryScanConfig {
  readonly now: number;
  readonly maxFundingAgeMs: number;
  readonly minimumNetCarryBps: number;
  readonly killSwitchActive: boolean;
  readonly paperTradingAllowed: boolean;
}

export interface FundingCarryCandidate {
  readonly id: string;
  readonly pair: SpotPerpetualPair;
  readonly expectedFunding: number;
  readonly expectedFundingBps: number;
  readonly totalTradingCost: number;
  readonly totalCostBps: number;
  readonly netCarry: number;
  readonly netCarryBps: number;
  readonly liquidityScore: number;
  readonly confidence: number;
  readonly nextFundingAt: number;
  readonly generatedAt: number;
}

export class FundingCarryScanError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "FUTURE_FUNDING" | "STALE_FUNDING") {
    super(code);
    this.name = "FundingCarryScanError";
  }
}

const money = (value: number): void => {
  if (!Number.isFinite(value) || value < 0) throw new FundingCarryScanError("INVALID_INPUT");
};
const unit = (value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new FundingCarryScanError("INVALID_INPUT");
};
const time = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new FundingCarryScanError("INVALID_INPUT");
};
const round8 = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;

const freezePair = (pair: SpotPerpetualPair): SpotPerpetualPair => Object.freeze({
  ...pair,
  spot: Object.freeze({ ...pair.spot }),
  perpetual: Object.freeze({ ...pair.perpetual })
});

export function scanFundingCarryCandidates(
  inputs: readonly FundingCarryMarketInput[],
  config: FundingCarryScanConfig
): readonly FundingCarryCandidate[] {
  time(config.now);
  time(config.maxFundingAgeMs);
  if (!Number.isFinite(config.minimumNetCarryBps)) throw new FundingCarryScanError("INVALID_INPUT");
  if (config.killSwitchActive || !config.paperTradingAllowed) return Object.freeze([]);
  const ids = new Set<string>();
  const candidates: FundingCarryCandidate[] = [];

  for (const input of inputs) {
    time(input.fundingObservedAt);
    time(input.nextFundingAt);
    if (input.fundingObservedAt > config.now || input.nextFundingAt <= config.now) throw new FundingCarryScanError("FUTURE_FUNDING");
    if (config.now - input.fundingObservedAt > config.maxFundingAgeMs) continue;
    if (!Number.isFinite(input.fundingRate) || input.fundingRate <= 0 || input.fundingDirection !== "SHORT_RECEIVES") continue;
    for (const value of [input.notional, input.spotEntryFeeBps, input.spotExitFeeBps, input.perpetualEntryFeeBps, input.perpetualExitFeeBps, input.expectedSlippageBps, input.basisRiskPremiumBps, input.partialFillRiskPremiumBps, input.capitalCostBps]) money(value);
    unit(input.liquidityScore);
    unit(input.confidence);

    const pair = freezePair(input.pair);
    const id = `${pair.venue}:${pair.spot.symbol}:${pair.perpetual.symbol}`;
    if (ids.has(id)) throw new FundingCarryScanError("INVALID_INPUT");
    ids.add(id);
    const expectedFundingBps = round8(input.fundingRate * 10_000);
    const totalCostBps = round8(input.spotEntryFeeBps + input.spotExitFeeBps + input.perpetualEntryFeeBps + input.perpetualExitFeeBps + input.expectedSlippageBps + input.basisRiskPremiumBps + input.partialFillRiskPremiumBps + input.capitalCostBps);
    const netCarryBps = round8(expectedFundingBps - totalCostBps);
    if (netCarryBps < config.minimumNetCarryBps) continue;
    const expectedFunding = round8(input.notional * input.fundingRate);
    const totalTradingCost = round8(input.notional * totalCostBps / 10_000);
    candidates.push(Object.freeze({
      id,
      pair,
      expectedFunding,
      expectedFundingBps,
      totalTradingCost,
      totalCostBps,
      netCarry: round8(expectedFunding - totalTradingCost),
      netCarryBps,
      liquidityScore: input.liquidityScore,
      confidence: input.confidence,
      nextFundingAt: input.nextFundingAt,
      generatedAt: config.now
    }));
  }
  return Object.freeze(candidates.sort((a, b) =>
    b.netCarry - a.netCarry || b.confidence - a.confidence || b.liquidityScore - a.liquidityScore || a.id.localeCompare(b.id)
  ));
}
