export interface ExchangeInstrument {
  readonly venue: string;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly kind: "SPOT" | "PERP";
  readonly active: boolean;
  readonly contractMultiplier?: number;
}

export interface FundingCarryOpportunityInput {
  readonly now: number;
  readonly spot: ExchangeInstrument;
  readonly perp: ExchangeInstrument;
  readonly fundingRate: number;
  readonly fundingObservedAt: number;
  readonly nextFundingAt: number;
  readonly maxFundingAgeMs: number;
  readonly notional: number;
  readonly entryExitFeeBps: number;
  readonly expectedSlippageBps: number;
  readonly basisRiskBps: number;
  readonly incompleteFillRiskBps: number;
  readonly capitalCostBps: number;
  readonly minimumNetCarryBps: number;
  readonly liquidityScore: number;
  readonly confidence: number;
  readonly killSwitchActive: boolean;
}

export interface FundingCarryOpportunity {
  readonly venue: string;
  readonly baseAsset: string;
  readonly spotSymbol: string;
  readonly perpSymbol: string;
  readonly expectedFundingBps: number;
  readonly totalCostBps: number;
  readonly netCarryBps: number;
  readonly notional: number;
  readonly liquidityScore: number;
  readonly confidence: number;
  readonly nextFundingAt: number;
  readonly generatedAt: number;
}

export interface DeltaNeutralStateInput {
  readonly now: number;
  readonly spotBaseQuantity: number;
  readonly perpShortContracts: number;
  readonly contractMultiplier: number;
  readonly toleranceBaseQuantity: number;
  readonly breachedSince?: number;
  readonly emergencyAfterMs: number;
  readonly liquidationBuffer: number;
  readonly minimumLiquidationBuffer: number;
  readonly basisBps: number;
  readonly maximumBasisBps: number;
}

export interface DeltaNeutralState {
  readonly delta: number;
  readonly status: "HEDGED" | "REBALANCE_REQUIRED" | "EMERGENCY_EXIT_REQUIRED";
  readonly reasons: readonly string[];
  readonly evaluatedAt: number;
}

const assertSafeTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};
const assertFinite = (value: number, field: string, min = 0): void => {
  if (!Number.isFinite(value) || value < min) throw new Error(`${field} is invalid`);
};
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function resolveSpotPerpPair(instruments: readonly ExchangeInstrument[], venue: string, baseAsset: string, quoteAsset: string): Readonly<{ spot: ExchangeInstrument; perp: ExchangeInstrument }> {
  const normalizedVenue = venue.trim().toUpperCase();
  const normalizedBase = baseAsset.trim().toUpperCase();
  const normalizedQuote = quoteAsset.trim().toUpperCase();
  if (!normalizedVenue || !normalizedBase || !normalizedQuote) throw new Error("venue, baseAsset and quoteAsset are required");
  const matches = instruments.filter((item) =>
    item.active && item.venue.trim().toUpperCase() === normalizedVenue && item.baseAsset.trim().toUpperCase() === normalizedBase && item.quoteAsset.trim().toUpperCase() === normalizedQuote
  );
  const spots = matches.filter((item) => item.kind === "SPOT");
  const perps = matches.filter((item) => item.kind === "PERP");
  if (spots.length !== 1 || perps.length !== 1) throw new Error("spot/perp pair is missing or ambiguous");
  return Object.freeze({ spot: Object.freeze({ ...spots[0] }), perp: Object.freeze({ ...perps[0] }) });
}

export function scanFundingCarry(input: FundingCarryOpportunityInput): FundingCarryOpportunity | null {
  assertSafeTime(input.now, "now");
  assertSafeTime(input.fundingObservedAt, "fundingObservedAt");
  assertSafeTime(input.nextFundingAt, "nextFundingAt");
  assertSafeTime(input.maxFundingAgeMs, "maxFundingAgeMs");
  if (input.fundingObservedAt > input.now || input.nextFundingAt < input.now) throw new Error("funding timestamps are invalid");
  if (input.now - input.fundingObservedAt > input.maxFundingAgeMs || input.killSwitchActive || input.fundingRate <= 0) return null;
  if (!input.spot.active || !input.perp.active || input.spot.kind !== "SPOT" || input.perp.kind !== "PERP") return null;
  if (input.spot.venue !== input.perp.venue || input.spot.baseAsset !== input.perp.baseAsset || input.spot.quoteAsset !== input.perp.quoteAsset) throw new Error("spot and perp instruments do not match");
  for (const [field, value] of Object.entries({
    notional: input.notional,
    entryExitFeeBps: input.entryExitFeeBps,
    expectedSlippageBps: input.expectedSlippageBps,
    basisRiskBps: input.basisRiskBps,
    incompleteFillRiskBps: input.incompleteFillRiskBps,
    capitalCostBps: input.capitalCostBps,
    minimumNetCarryBps: input.minimumNetCarryBps,
    liquidityScore: input.liquidityScore,
    confidence: input.confidence
  })) assertFinite(value, field);
  if (input.liquidityScore > 1 || input.confidence > 1) throw new Error("liquidityScore and confidence must be between 0 and 1");
  const expectedFundingBps = round4(input.fundingRate * 10_000);
  const totalCostBps = round4(input.entryExitFeeBps + input.expectedSlippageBps + input.basisRiskBps + input.incompleteFillRiskBps + input.capitalCostBps);
  const netCarryBps = round4(expectedFundingBps - totalCostBps);
  if (netCarryBps < input.minimumNetCarryBps) return null;
  return Object.freeze({
    venue: input.spot.venue,
    baseAsset: input.spot.baseAsset,
    spotSymbol: input.spot.symbol,
    perpSymbol: input.perp.symbol,
    expectedFundingBps,
    totalCostBps,
    netCarryBps,
    notional: input.notional,
    liquidityScore: input.liquidityScore,
    confidence: input.confidence,
    nextFundingAt: input.nextFundingAt,
    generatedAt: input.now
  });
}

export function evaluateDeltaNeutralState(input: DeltaNeutralStateInput): DeltaNeutralState {
  assertSafeTime(input.now, "now");
  assertSafeTime(input.emergencyAfterMs, "emergencyAfterMs");
  if (input.breachedSince !== undefined) assertSafeTime(input.breachedSince, "breachedSince");
  for (const [field, value] of Object.entries({
    spotBaseQuantity: input.spotBaseQuantity,
    perpShortContracts: input.perpShortContracts,
    contractMultiplier: input.contractMultiplier,
    toleranceBaseQuantity: input.toleranceBaseQuantity,
    liquidationBuffer: input.liquidationBuffer,
    minimumLiquidationBuffer: input.minimumLiquidationBuffer,
    basisBps: input.basisBps,
    maximumBasisBps: input.maximumBasisBps
  })) assertFinite(value, field);
  if (input.contractMultiplier <= 0) throw new Error("contractMultiplier must be positive");
  const delta = round4(input.spotBaseQuantity - input.perpShortContracts * input.contractMultiplier);
  const reasons: string[] = [];
  if (Math.abs(delta) > input.toleranceBaseQuantity) reasons.push("DELTA_OUT_OF_RANGE");
  if (input.liquidationBuffer < input.minimumLiquidationBuffer) reasons.push("LIQUIDATION_BUFFER_LOW");
  if (input.basisBps > input.maximumBasisBps) reasons.push("BASIS_TOO_WIDE");
  const prolonged = input.breachedSince !== undefined && input.now - input.breachedSince >= input.emergencyAfterMs;
  const emergency = prolonged || reasons.includes("LIQUIDATION_BUFFER_LOW") || reasons.includes("BASIS_TOO_WIDE");
  return Object.freeze({
    delta,
    status: reasons.length === 0 ? "HEDGED" : emergency ? "EMERGENCY_EXIT_REQUIRED" : "REBALANCE_REQUIRED",
    reasons: Object.freeze(reasons.sort()),
    evaluatedAt: input.now
  });
}

export interface FundingCarryExitInput {
  readonly fundingRate: number;
  readonly netCarryBps: number;
  readonly basisBps: number;
  readonly maximumBasisBps: number;
  readonly liquidityScore: number;
  readonly minimumLiquidityScore: number;
  readonly liquidationBuffer: number;
  readonly minimumLiquidationBuffer: number;
  readonly killSwitchActive: boolean;
  readonly withdrawalReservationActive: boolean;
}

export function decideFundingCarryExit(input: FundingCarryExitInput): Readonly<{ action: "HOLD" | "REDUCE" | "EXIT"; reasons: readonly string[] }> {
  const reasons: string[] = [];
  if (input.killSwitchActive) reasons.push("KILL_SWITCH");
  if (input.fundingRate <= 0) reasons.push("FUNDING_REVERSED");
  if (input.netCarryBps < 0) reasons.push("NEGATIVE_NET_CARRY");
  if (input.basisBps > input.maximumBasisBps) reasons.push("BASIS_TOO_WIDE");
  if (input.liquidityScore < input.minimumLiquidityScore) reasons.push("LIQUIDITY_LOW");
  if (input.liquidationBuffer < input.minimumLiquidationBuffer) reasons.push("LIQUIDATION_BUFFER_LOW");
  if (input.withdrawalReservationActive) reasons.push("WITHDRAWAL_RESERVATION");
  const severe = reasons.some((reason) => ["KILL_SWITCH", "FUNDING_REVERSED", "LIQUIDATION_BUFFER_LOW"].includes(reason));
  return Object.freeze({ action: severe ? "EXIT" : reasons.length > 0 ? "REDUCE" : "HOLD", reasons: Object.freeze(reasons.sort()) });
}
