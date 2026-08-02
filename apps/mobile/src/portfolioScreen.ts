export type PortfolioPeriod = "1D" | "7D" | "30D" | "90D" | "1Y" | "ALL";
export type PortfolioHealth = "HEALTHY" | "ATTENTION" | "ACTION_REQUIRED" | "UNKNOWN";

export interface PortfolioScreenInput {
  readonly generatedAt: number;
  readonly totalEquity: number;
  readonly totalPnl: number;
  readonly todaysPnl: number;
  readonly totalReturn: number | null;
  readonly healthScore: number | null;
  readonly health: PortfolioHealth;
  readonly allocation: {
    readonly cash: { readonly value: number; readonly dailyChange: number };
    readonly activePositions: { readonly value: number; readonly dailyChange: number };
    readonly reservedCapital: { readonly value: number; readonly dailyChange: number };
  };
  readonly positions: readonly {
    readonly symbol: string;
    readonly direction: "LONG" | "SHORT";
    readonly quantity: number;
    readonly entryPrice: number;
    readonly currentPrice: number;
    readonly unrealizedPnl: number;
    readonly risk: PortfolioHealth;
    readonly holdingTimeMs: number | null;
  }[];
  readonly performance: Readonly<Partial<Record<PortfolioPeriod, readonly { readonly timestamp: number; readonly equity: number; readonly pnl: number }[]>>>;
  readonly risk: {
    readonly exposure: number;
    readonly availableCapital: number;
    readonly riskBudgetUsed: number;
    readonly currentDrawdown: number;
    readonly maxDrawdown: number;
    readonly dailyLoss: number;
    readonly consecutiveLosses: number;
    readonly warnings: readonly string[];
  };
  readonly strategies: readonly {
    readonly id: string;
    readonly profit: number;
    readonly drawdown: number;
    readonly winRate: number;
    readonly contribution: number;
    readonly status: string;
  }[];
  readonly nextReviewAt?: number | null;
  readonly rebalanceSupported: boolean;
}

export interface PortfolioScreenState extends Omit<PortfolioScreenInput, "allocation" | "positions" | "performance" | "strategies"> {
  readonly allocation: readonly { readonly name: "CASH" | "ACTIVE_POSITIONS" | "RESERVED_CAPITAL"; readonly value: number; readonly percentage: number; readonly dailyChange: number }[];
  readonly positions: readonly PortfolioScreenInput["positions"][number][];
  readonly performance: PortfolioScreenInput["performance"];
  readonly strategies: readonly PortfolioScreenInput["strategies"][number][];
  readonly allocationSegments: readonly { readonly name: "CASH" | "CRYPTO" | "RESERVED_CAPITAL"; readonly value: number; readonly percentage: number; readonly dailyChange: number }[];
  readonly positionActions: readonly { readonly symbol: string; readonly view: true; readonly close: true; readonly modifyTakeProfitStopLoss: true; readonly confirmationRequired: true }[];
  readonly aiInsights: Readonly<{ readonly bestPerformer: string | null; readonly weakestPosition: string | null; readonly highestRisk: string | null; readonly capitalRecommendation: string; readonly nextReviewAt: number | null }>;
  readonly exports: Readonly<{ portfolioReport: true; csv: true; pdf: false }>;
  readonly quickActions: Readonly<{ closeAll: boolean; exportPortfolio: true; portfolioReport: true; rebalance: boolean; confirmationRequired: true }>;
  readonly emptyState?: { readonly cash: number; readonly showMarketSummary: true; readonly suggestedAction: string };
}

const PERIODS: readonly PortfolioPeriod[] = ["1D", "7D", "30D", "90D", "1Y", "ALL"];
const assertFinite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const assertNonNegative = (value: number, name: string): void => { assertFinite(value, name); if (value < 0) throw new Error(`${name} must be non-negative`); };
const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

export function buildPortfolioScreen(input: PortfolioScreenInput): PortfolioScreenState {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  assertNonNegative(input.totalEquity, "totalEquity");
  assertFinite(input.totalPnl, "totalPnl"); assertFinite(input.todaysPnl, "todaysPnl");
  if (input.totalReturn !== null) assertFinite(input.totalReturn, "totalReturn");
  if (input.healthScore !== null && (input.healthScore < 0 || input.healthScore > 100)) throw new Error("healthScore must be between 0 and 100");
  const buckets = [
    ["CASH", input.allocation.cash], ["ACTIVE_POSITIONS", input.allocation.activePositions], ["RESERVED_CAPITAL", input.allocation.reservedCapital]
  ] as const;
  for (const [name, item] of buckets) { assertNonNegative(item.value, `allocation.${name}.value`); assertFinite(item.dailyChange, `allocation.${name}.dailyChange`); }
  const allocated = buckets.reduce((sum, [, item]) => sum + item.value, 0);
  const tolerance = Math.max(1e-6, input.totalEquity * 1e-9);
  if (Math.abs(allocated - input.totalEquity) > tolerance) throw new Error("portfolio allocation does not reconcile");
  const allocation = freezeList(buckets.map(([name, item]) => Object.freeze({ name, value: item.value, percentage: input.totalEquity === 0 ? 0 : item.value / input.totalEquity, dailyChange: item.dailyChange })));
  for (const position of input.positions) { if (!position.symbol.trim()) throw new Error("position symbol is required"); assertNonNegative(position.quantity, "position.quantity"); assertNonNegative(position.entryPrice, "position.entryPrice"); assertNonNegative(position.currentPrice, "position.currentPrice"); assertFinite(position.unrealizedPnl, "position.unrealizedPnl"); if (position.holdingTimeMs !== null) assertNonNegative(position.holdingTimeMs, "position.holdingTimeMs"); }
  for (const period of PERIODS) for (const point of input.performance[period] ?? []) { if (!Number.isSafeInteger(point.timestamp) || point.timestamp < 0) throw new Error("performance timestamp is invalid"); assertNonNegative(point.equity, "performance.equity"); assertFinite(point.pnl, "performance.pnl"); }
  assertNonNegative(input.risk.exposure, "risk.exposure"); assertNonNegative(input.risk.availableCapital, "risk.availableCapital"); assertNonNegative(input.risk.riskBudgetUsed, "risk.riskBudgetUsed"); assertNonNegative(input.risk.currentDrawdown, "risk.currentDrawdown"); assertNonNegative(input.risk.maxDrawdown, "risk.maxDrawdown"); assertNonNegative(input.risk.dailyLoss, "risk.dailyLoss"); assertNonNegative(input.risk.consecutiveLosses, "risk.consecutiveLosses");
  for (const strategy of input.strategies) { if (!strategy.id.trim()) throw new Error("strategy id is required"); assertFinite(strategy.profit, "strategy.profit"); assertNonNegative(strategy.drawdown, "strategy.drawdown"); if (strategy.winRate < 0 || strategy.winRate > 1) throw new Error("strategy.winRate must be between 0 and 1"); if (strategy.contribution < 0 || strategy.contribution > 1) throw new Error("strategy.contribution must be between 0 and 1"); }
  const strategies = freezeList([...input.strategies].sort((left, right) => right.profit - left.profit || left.id.localeCompare(right.id)));
  const emptyState = input.positions.length === 0 ? Object.freeze({ cash: input.allocation.cash.value, showMarketSummary: true as const, suggestedAction: "마켓을 확인하고 다음 Paper 포지션을 검토하세요." }) : undefined;
  if (input.nextReviewAt !== undefined && input.nextReviewAt !== null && (!Number.isSafeInteger(input.nextReviewAt) || input.nextReviewAt < 0)) throw new Error("nextReviewAt is invalid");
  const allocationSegments = freezeList([
    { name: "CASH" as const, value: input.allocation.cash.value, percentage: input.totalEquity === 0 ? 0 : input.allocation.cash.value / input.totalEquity, dailyChange: input.allocation.cash.dailyChange },
    { name: "CRYPTO" as const, value: input.allocation.activePositions.value, percentage: input.totalEquity === 0 ? 0 : input.allocation.activePositions.value / input.totalEquity, dailyChange: input.allocation.activePositions.dailyChange },
    { name: "RESERVED_CAPITAL" as const, value: input.allocation.reservedCapital.value, percentage: input.totalEquity === 0 ? 0 : input.allocation.reservedCapital.value / input.totalEquity, dailyChange: input.allocation.reservedCapital.dailyChange }
  ]);
  const positionActions = freezeList(input.positions.map((position) => ({ symbol: position.symbol, view: true as const, close: true as const, modifyTakeProfitStopLoss: true as const, confirmationRequired: true as const })));
  const bestPerformer = strategies[0]?.id ?? null;
  const weakestPosition = input.positions.length ? [...input.positions].sort((left, right) => left.unrealizedPnl - right.unrealizedPnl || left.symbol.localeCompare(right.symbol))[0]!.symbol : null;
  const highestRisk = input.positions.find((position) => position.risk === "ACTION_REQUIRED")?.symbol ?? input.positions.find((position) => position.risk === "ATTENTION")?.symbol ?? null;
  const capitalRecommendation = input.risk.availableCapital > 0 && input.risk.currentDrawdown === 0 ? "Available capital is present; allocate only after Risk approval." : "Preserve available capital until risk conditions improve.";
  return Object.freeze({ ...input, allocation, allocationSegments, positions: freezeList(input.positions), positionActions, performance: Object.freeze({ ...input.performance }), strategies, aiInsights: Object.freeze({ bestPerformer, weakestPosition, highestRisk, capitalRecommendation, nextReviewAt: input.nextReviewAt ?? null }), exports: Object.freeze({ portfolioReport: true as const, csv: true as const, pdf: false as const }), quickActions: Object.freeze({ closeAll: input.positions.length > 0, exportPortfolio: true, portfolioReport: true, rebalance: input.rebalanceSupported, confirmationRequired: true as const }), ...(emptyState ? { emptyState } : {}) });
}
