import type { IntelligenceDashboard, RiskLevel } from "./intelligenceDashboard";

export type TradingMode = "PAPER" | "LIVE" | "STOPPED" | "FAULTED";
export type AiHealth = "HEALTHY" | "DEGRADED" | "OFFLINE";
export type CapitalBucket = "SPOT" | "FUTURES" | "CASH" | "WITHDRAWAL" | "RESERVE" | "PENDING";

export interface CapitalAllocation {
  readonly bucket: CapitalBucket;
  readonly amount: number;
}

export interface HomeDashboardInput {
  readonly generatedAt: number;
  readonly currency: "KRW" | "USDT";
  readonly totalAssets: number;
  readonly dailyPnl: number;
  readonly dailyReturn: number;
  readonly mode: TradingMode;
  readonly aiHealth: AiHealth;
  readonly riskLevel: RiskLevel;
  readonly allocations: readonly CapitalAllocation[];
  readonly intelligence: IntelligenceDashboard;
}

export interface HomeDashboard {
  readonly generatedAt: number;
  readonly currency: "KRW" | "USDT";
  readonly totalAssets: number;
  readonly dailyPnl: number;
  readonly dailyReturn: number;
  readonly mode: TradingMode;
  readonly aiHealth: AiHealth;
  readonly riskLevel: RiskLevel;
  readonly allocations: readonly CapitalAllocation[];
  readonly deployableCapital: number;
  readonly protectedCapital: number;
  readonly pendingCapital: number;
  readonly canTrade: boolean;
  readonly intelligence: IntelligenceDashboard;
}

const ALL_BUCKETS: readonly CapitalBucket[] = ["SPOT", "FUTURES", "CASH", "WITHDRAWAL", "RESERVE", "PENDING"];

const assertFiniteNonNegative = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be finite and non-negative`);
  }
};

export const buildHomeDashboard = (input: HomeDashboardInput): HomeDashboard => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error("generatedAt must be a non-negative safe integer");
  }
  assertFiniteNonNegative(input.totalAssets, "totalAssets");
  if (!Number.isFinite(input.dailyPnl)) {
    throw new Error("dailyPnl must be finite");
  }
  if (!Number.isFinite(input.dailyReturn)) {
    throw new Error("dailyReturn must be finite");
  }
  if (input.intelligence.generatedAt > input.generatedAt) {
    throw new Error("intelligence cannot be generated in the future");
  }

  const seen = new Set<CapitalBucket>();
  const allocations = input.allocations.map((allocation) => {
    if (!ALL_BUCKETS.includes(allocation.bucket)) {
      throw new Error(`unsupported capital bucket: ${allocation.bucket}`);
    }
    if (seen.has(allocation.bucket)) {
      throw new Error(`duplicate capital bucket: ${allocation.bucket}`);
    }
    seen.add(allocation.bucket);
    assertFiniteNonNegative(allocation.amount, `allocation.${allocation.bucket}`);
    return Object.freeze({ ...allocation });
  });

  const byBucket = new Map(allocations.map((allocation) => [allocation.bucket, allocation.amount]));
  const totalAllocated = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const tolerance = Math.max(1e-6, input.totalAssets * 1e-9);
  if (Math.abs(totalAllocated - input.totalAssets) > tolerance) {
    throw new Error("capital allocations must reconcile to totalAssets");
  }

  const deployableCapital = (byBucket.get("SPOT") ?? 0) + (byBucket.get("FUTURES") ?? 0) + (byBucket.get("CASH") ?? 0);
  const protectedCapital = (byBucket.get("WITHDRAWAL") ?? 0) + (byBucket.get("RESERVE") ?? 0);
  const pendingCapital = byBucket.get("PENDING") ?? 0;
  // This legacy projection must never imply production execution authority.
  const canTrade = input.mode === "PAPER";

  return Object.freeze({
    generatedAt: input.generatedAt,
    currency: input.currency,
    totalAssets: input.totalAssets,
    dailyPnl: input.dailyPnl,
    dailyReturn: input.dailyReturn,
    mode: input.mode,
    aiHealth: input.aiHealth,
    riskLevel: input.riskLevel,
    allocations: Object.freeze([...allocations].sort((left, right) => ALL_BUCKETS.indexOf(left.bucket) - ALL_BUCKETS.indexOf(right.bucket))),
    deployableCapital,
    protectedCapital,
    pendingCapital,
    canTrade,
    intelligence: input.intelligence
  });
};
