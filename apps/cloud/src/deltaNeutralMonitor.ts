export type DeltaNeutralStatus = "HEDGED" | "REBALANCE_REQUIRED" | "EMERGENCY_EXIT_REQUIRED";

export interface DeltaNeutralMonitorInput {
  readonly now: number;
  readonly spotBaseQuantity: number;
  readonly perpetualShortContracts: number;
  readonly contractMultiplier: number;
  readonly quantityPrecision: number;
  readonly minimumOrderQuantity: number;
  readonly deltaTolerance: number;
  readonly breachedSince?: number;
  readonly emergencyAfterMs: number;
  readonly maintenanceMarginRatio: number;
  readonly maximumMaintenanceMarginRatio: number;
  readonly liquidationPriceBufferBps: number;
  readonly minimumLiquidationPriceBufferBps: number;
  readonly basisBps: number;
  readonly maximumBasisBps: number;
}

export interface DeltaNeutralMonitorResult {
  readonly delta: number;
  readonly shortBaseEquivalent: number;
  readonly requiredRebalanceQuantity: number;
  readonly status: DeltaNeutralStatus;
  readonly reasons: readonly string[];
  readonly evaluatedAt: number;
}

const finite = (value: number, field: string, minimum = 0): void => {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${field} is invalid`);
};
const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is invalid`);
};
const round = (value: number, precision: number): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export function monitorDeltaNeutralPosition(input: DeltaNeutralMonitorInput): DeltaNeutralMonitorResult {
  time(input.now, "now");
  time(input.emergencyAfterMs, "emergencyAfterMs");
  if (input.breachedSince !== undefined) {
    time(input.breachedSince, "breachedSince");
    if (input.breachedSince > input.now) throw new Error("breachedSince is invalid");
  }
  if (!Number.isInteger(input.quantityPrecision) || input.quantityPrecision < 0 || input.quantityPrecision > 12) throw new Error("quantityPrecision is invalid");
  for (const [field, value] of Object.entries({
    spotBaseQuantity: input.spotBaseQuantity,
    perpetualShortContracts: input.perpetualShortContracts,
    contractMultiplier: input.contractMultiplier,
    minimumOrderQuantity: input.minimumOrderQuantity,
    deltaTolerance: input.deltaTolerance,
    maintenanceMarginRatio: input.maintenanceMarginRatio,
    maximumMaintenanceMarginRatio: input.maximumMaintenanceMarginRatio,
    liquidationPriceBufferBps: input.liquidationPriceBufferBps,
    minimumLiquidationPriceBufferBps: input.minimumLiquidationPriceBufferBps,
    basisBps: input.basisBps,
    maximumBasisBps: input.maximumBasisBps
  })) finite(value, field);
  if (input.contractMultiplier <= 0 || input.minimumOrderQuantity <= 0) throw new Error("contract multiplier and minimum order quantity must be positive");

  const shortBaseEquivalent = round(input.perpetualShortContracts * input.contractMultiplier, input.quantityPrecision);
  const delta = round(input.spotBaseQuantity - shortBaseEquivalent, input.quantityPrecision);
  const requiredRebalanceQuantity = round(Math.abs(delta) < input.minimumOrderQuantity ? 0 : Math.abs(delta), input.quantityPrecision);
  const reasons: string[] = [];
  if (Math.abs(delta) > input.deltaTolerance) reasons.push("DELTA_OUT_OF_RANGE");
  if (input.maintenanceMarginRatio > input.maximumMaintenanceMarginRatio) reasons.push("MAINTENANCE_MARGIN_HIGH");
  if (input.liquidationPriceBufferBps < input.minimumLiquidationPriceBufferBps) reasons.push("LIQUIDATION_BUFFER_LOW");
  if (input.basisBps > input.maximumBasisBps) reasons.push("BASIS_TOO_WIDE");
  const recoveryTimedOut = reasons.includes("DELTA_OUT_OF_RANGE") && input.breachedSince !== undefined && input.now - input.breachedSince >= input.emergencyAfterMs;
  if (recoveryTimedOut) reasons.push("DELTA_RECOVERY_TIMEOUT");
  const emergency = recoveryTimedOut || reasons.includes("MAINTENANCE_MARGIN_HIGH") || reasons.includes("LIQUIDATION_BUFFER_LOW") || reasons.includes("BASIS_TOO_WIDE");
  return Object.freeze({
    delta,
    shortBaseEquivalent,
    requiredRebalanceQuantity,
    status: reasons.length === 0 ? "HEDGED" : emergency ? "EMERGENCY_EXIT_REQUIRED" : "REBALANCE_REQUIRED",
    reasons: Object.freeze(reasons.sort()),
    evaluatedAt: input.now
  });
}
