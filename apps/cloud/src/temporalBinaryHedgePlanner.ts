export type BinaryOutcome = "UP" | "DOWN";

export interface BinaryFill {
  readonly outcome: BinaryOutcome;
  readonly price: number;
  readonly quantity: number;
  readonly fee: number;
  readonly filledAt: number;
}

export interface TemporalHedgePlannerInput {
  readonly now: number;
  readonly fills: readonly BinaryFill[];
  readonly nextOutcome: BinaryOutcome;
  readonly nextPrice: number;
  readonly availableCapital: number;
  readonly targetProtectedQuantity: number;
  readonly maxUnhedgedCapital: number;
  readonly minimumLockedEdge: number;
  readonly lowPriceThreshold: number;
  readonly lowPriceSizeMultiplier: number;
  readonly highPriceSizeMultiplier: number;
}

export interface TemporalHedgePlan {
  readonly outcome: BinaryOutcome;
  readonly quantity: number;
  readonly estimatedCost: number;
  readonly protectedQuantityAfter: number;
  readonly weightedCompleteSetCost: number | null;
  readonly lockedEdgePerSet: number | null;
  readonly unhedgedCapitalAfter: number;
  readonly status: "BUILD" | "COMPLETE_SET" | "REJECT";
  readonly reason: string;
  readonly plannedAt: number;
}

const assertMoney = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`);
};
const assertUnit = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};
const round8 = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;

export function planTemporalBinaryHedge(input: TemporalHedgePlannerInput): TemporalHedgePlan {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now is invalid");
  assertUnit(input.nextPrice, "nextPrice");
  if (input.nextPrice <= 0 || input.nextPrice >= 1) throw new Error("nextPrice must be strictly between 0 and 1");
  assertMoney(input.availableCapital, "availableCapital");
  assertMoney(input.targetProtectedQuantity, "targetProtectedQuantity");
  assertMoney(input.maxUnhedgedCapital, "maxUnhedgedCapital");
  assertMoney(input.minimumLockedEdge, "minimumLockedEdge");
  assertUnit(input.lowPriceThreshold, "lowPriceThreshold");
  assertMoney(input.lowPriceSizeMultiplier, "lowPriceSizeMultiplier");
  assertMoney(input.highPriceSizeMultiplier, "highPriceSizeMultiplier");

  let upQty = 0;
  let downQty = 0;
  let upCost = 0;
  let downCost = 0;
  for (const fill of input.fills) {
    assertUnit(fill.price, "fill.price");
    if (fill.price <= 0 || fill.price >= 1) throw new Error("fill.price must be strictly between 0 and 1");
    assertMoney(fill.quantity, "fill.quantity");
    assertMoney(fill.fee, "fill.fee");
    if (!Number.isSafeInteger(fill.filledAt) || fill.filledAt < 0 || fill.filledAt > input.now) throw new Error("fill.filledAt is invalid");
    if (fill.outcome === "UP") {
      upQty += fill.quantity;
      upCost += fill.price * fill.quantity + fill.fee;
    } else {
      downQty += fill.quantity;
      downCost += fill.price * fill.quantity + fill.fee;
    }
  }

  const currentProtected = Math.min(upQty, downQty);
  const missingProtected = Math.max(0, input.targetProtectedQuantity - currentProtected);
  const sideQty = input.nextOutcome === "UP" ? upQty : downQty;
  const oppositeQty = input.nextOutcome === "UP" ? downQty : upQty;
  const sizeMultiplier = input.nextPrice <= input.lowPriceThreshold
    ? input.lowPriceSizeMultiplier
    : input.highPriceSizeMultiplier;

  const quantityCapByCapital = input.availableCapital / input.nextPrice;
  const quantityNeededForBalance = Math.max(0, oppositeQty - sideQty);
  const desiredQuantity = Math.max(quantityNeededForBalance, missingProtected * sizeMultiplier);
  const quantity = round8(Math.min(desiredQuantity, quantityCapByCapital));

  if (quantity <= 0) {
    return Object.freeze({
      outcome: input.nextOutcome,
      quantity: 0,
      estimatedCost: 0,
      protectedQuantityAfter: currentProtected,
      weightedCompleteSetCost: null,
      lockedEdgePerSet: null,
      unhedgedCapitalAfter: round8(Math.abs(upCost - downCost)),
      status: "REJECT",
      reason: "No affordable quantity is available",
      plannedAt: input.now
    });
  }

  const nextCost = input.nextPrice * quantity;
  const nextUpQty = upQty + (input.nextOutcome === "UP" ? quantity : 0);
  const nextDownQty = downQty + (input.nextOutcome === "DOWN" ? quantity : 0);
  const nextUpCost = upCost + (input.nextOutcome === "UP" ? nextCost : 0);
  const nextDownCost = downCost + (input.nextOutcome === "DOWN" ? nextCost : 0);
  const protectedQuantityAfter = Math.min(nextUpQty, nextDownQty);
  const unmatchedUpQty = Math.max(0, nextUpQty - protectedQuantityAfter);
  const unmatchedDownQty = Math.max(0, nextDownQty - protectedQuantityAfter);
  const avgUp = nextUpQty > 0 ? nextUpCost / nextUpQty : 0;
  const avgDown = nextDownQty > 0 ? nextDownCost / nextDownQty : 0;
  const weightedCompleteSetCost = protectedQuantityAfter > 0 ? round8(avgUp + avgDown) : null;
  const lockedEdgePerSet = weightedCompleteSetCost === null ? null : round8(1 - weightedCompleteSetCost);
  const unhedgedCapitalAfter = round8(unmatchedUpQty * avgUp + unmatchedDownQty * avgDown);

  if (unhedgedCapitalAfter > input.maxUnhedgedCapital) {
    return Object.freeze({
      outcome: input.nextOutcome,
      quantity: 0,
      estimatedCost: 0,
      protectedQuantityAfter: currentProtected,
      weightedCompleteSetCost,
      lockedEdgePerSet,
      unhedgedCapitalAfter,
      status: "REJECT",
      reason: "Projected unhedged capital exceeds limit",
      plannedAt: input.now
    });
  }

  const complete = protectedQuantityAfter > currentProtected;
  if (complete && lockedEdgePerSet !== null && lockedEdgePerSet < input.minimumLockedEdge) {
    return Object.freeze({
      outcome: input.nextOutcome,
      quantity: 0,
      estimatedCost: 0,
      protectedQuantityAfter: currentProtected,
      weightedCompleteSetCost,
      lockedEdgePerSet,
      unhedgedCapitalAfter,
      status: "REJECT",
      reason: "Complete-set edge is below minimum after costs",
      plannedAt: input.now
    });
  }

  return Object.freeze({
    outcome: input.nextOutcome,
    quantity,
    estimatedCost: round8(nextCost),
    protectedQuantityAfter: round8(protectedQuantityAfter),
    weightedCompleteSetCost,
    lockedEdgePerSet,
    unhedgedCapitalAfter,
    status: complete ? "COMPLETE_SET" : "BUILD",
    reason: complete ? "Adds protected quantity at an acceptable combined cost" : "Builds one side within the unhedged exposure limit",
    plannedAt: input.now
  });
}
