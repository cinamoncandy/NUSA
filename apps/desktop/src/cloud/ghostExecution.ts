import type { AbstentionAssessment } from "./abstentionEngine";

export type GhostSide = "LONG" | "SHORT";
export type GhostExecutionStatus = "SIMULATED" | "SKIPPED";

export interface GhostExecutionInput {
  readonly abstention: AbstentionAssessment;
  readonly side: GhostSide;
  readonly entryObservedPrice: number;
  readonly exitObservedPrice: number;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly feeRate: number;
  readonly slippageRate: number;
}

export interface GhostExecutionResult {
  readonly schemaVersion: 1;
  readonly status: GhostExecutionStatus;
  readonly side: GhostSide;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly holdingPeriodMs: number;
  readonly modeledEntryPrice?: number;
  readonly modeledExitPrice?: number;
  readonly grossReturn?: number;
  readonly totalCostRate?: number;
  readonly netReturn?: number;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export class GhostExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GhostExecutionError";
  }
}

function assertFinitePositive(value: number, code: string, message: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new GhostExecutionError(code, message);
}

export function simulateGhostExecution(input: GhostExecutionInput): GhostExecutionResult {
  if (input.abstention.schemaVersion !== 1) throw new GhostExecutionError("UNSUPPORTED_ABSTENTION_SCHEMA", "abstention schema is unsupported");
  if (input.exitTime <= input.entryTime) throw new GhostExecutionError("INVALID_HORIZON", "exitTime must be greater than entryTime");
  assertFinitePositive(input.entryObservedPrice, "INVALID_ENTRY_PRICE", "entryObservedPrice must be finite and positive");
  assertFinitePositive(input.exitObservedPrice, "INVALID_EXIT_PRICE", "exitObservedPrice must be finite and positive");
  if (!Number.isFinite(input.entryTime) || !Number.isFinite(input.exitTime)) throw new GhostExecutionError("INVALID_TIMESTAMP", "timestamps must be finite");
  if (!Number.isFinite(input.feeRate) || input.feeRate < 0 || input.feeRate >= 1) throw new GhostExecutionError("INVALID_FEE_RATE", "feeRate must be in [0, 1)");
  if (!Number.isFinite(input.slippageRate) || input.slippageRate < 0 || input.slippageRate >= 1) throw new GhostExecutionError("INVALID_SLIPPAGE_RATE", "slippageRate must be in [0, 1)");

  const base = {
    schemaVersion: 1 as const,
    side: input.side,
    entryTime: input.entryTime,
    exitTime: input.exitTime,
    holdingPeriodMs: input.exitTime - input.entryTime,
    sourceDatasetIds: Object.freeze([...input.abstention.sourceDatasetIds]),
  };

  if (input.abstention.decision !== "PROCEED_RESEARCH") {
    return Object.freeze({
      ...base,
      status: "SKIPPED" as const,
      reasons: Object.freeze(["ABSTENTION_BLOCKED"]),
    });
  }

  const direction = input.side === "LONG" ? 1 : -1;
  const modeledEntryPrice = input.entryObservedPrice * (1 + direction * input.slippageRate);
  const modeledExitPrice = input.exitObservedPrice * (1 - direction * input.slippageRate);
  const grossReturn = input.side === "LONG"
    ? modeledExitPrice / modeledEntryPrice - 1
    : modeledEntryPrice / modeledExitPrice - 1;
  const totalCostRate = input.feeRate * 2;
  const netReturn = grossReturn - totalCostRate;

  if (![modeledEntryPrice, modeledExitPrice, grossReturn, totalCostRate, netReturn].every(Number.isFinite)) {
    throw new GhostExecutionError("NON_FINITE_RESULT", "ghost execution produced non-finite evidence");
  }

  return Object.freeze({
    ...base,
    status: "SIMULATED" as const,
    modeledEntryPrice,
    modeledExitPrice,
    grossReturn,
    totalCostRate,
    netReturn,
    reasons: Object.freeze([]),
  });
}
