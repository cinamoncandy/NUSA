export type StrategyStatus = "RUNNING" | "WAITING" | "PAUSED" | "ERROR" | "DISABLED";
export type StrategyHealth = "HEALTHY" | "ATTENTION" | "ACTION_REQUIRED" | "UNKNOWN";
export type StrategyDetailTab = "OVERVIEW" | "PERFORMANCE" | "RISK" | "POSITION" | "SIGNALS" | "TRADES" | "AI_ANALYSIS";

export interface StrategyManagementInput {
  readonly generatedAt: number;
  readonly strategies: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: StrategyStatus;
    readonly market: string | null;
    readonly regime: string | null;
    readonly todaysPnl: number;
    readonly totalPnl: number;
    readonly winRate: number;
    readonly profitFactor: number | null;
    readonly drawdown: number;
    readonly confidence: number | null;
    readonly health: StrategyHealth;
    readonly lastSignal: string | null;
    readonly lastTradeAt: number | null;
    readonly nextEvaluationAt: number | null;
    readonly runtimeStatus: string;
    readonly websocketStatus: string;
    readonly errorCount: number;
    readonly capitalUsage: number;
    readonly sharpeRatio: number | null;
    readonly recoveryFactor: number | null;
    readonly stability: number | null;
    readonly config: { readonly positionSize: number; readonly riskPercent: number; readonly stopLoss: number | null; readonly takeProfit: number | null; readonly maxDailyLoss: number; readonly maxExposure: number; readonly tradingHours: readonly string[]; readonly allowedRegimes: readonly string[]; readonly allowedSymbols: readonly string[] };
  }[];
  readonly selectedStrategyId: string | null;
  readonly selectedTab: StrategyDetailTab;
}

export interface StrategyManagementState extends StrategyManagementInput {
  readonly header: Readonly<{ active: number; paused: number; totalProfit: number; portfolioContribution: number; overallHealth: StrategyHealth }>;
  readonly comparison: readonly StrategyManagementInput["strategies"][number][];
  readonly controls: Readonly<Record<"start" | "pause" | "resume" | "stop" | "duplicate" | "export" | "archive", boolean>>;
  readonly batchControls: Readonly<{ pause: boolean; resume: boolean; stop: boolean; confirmationRequired: true }>;
  readonly aiAssistant: Readonly<{ best: string | null; weakest: string | null; suggestedPause: string | null; suggestedOptimization: string | null; confidenceTrend: number | null; autoApply: false }>;
  readonly emptyState?: Readonly<{ create: true; import: true; templates: true; documentation: true }>;
}

const statuses: readonly StrategyStatus[] = ["RUNNING", "WAITING", "PAUSED", "ERROR", "DISABLED"];
const tabs: readonly StrategyDetailTab[] = ["OVERVIEW", "PERFORMANCE", "RISK", "POSITION", "SIGNALS", "TRADES", "AI_ANALYSIS"];
const finite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const nonNegative = (value: number, name: string): void => { finite(value, name); if (value < 0) throw new Error(`${name} must be non-negative`); };
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function validate(input: StrategyManagementInput): void {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt is invalid");
  if (input.selectedStrategyId !== null && !input.strategies.some((strategy) => strategy.id === input.selectedStrategyId)) throw new Error("selected strategy is unavailable");
  if (!tabs.includes(input.selectedTab)) throw new Error("strategy tab is invalid");
  const ids = new Set<string>();
  for (const strategy of input.strategies) {
    if (!strategy.id.trim() || !strategy.name.trim() || ids.has(strategy.id)) throw new Error("strategy identity is invalid");
    ids.add(strategy.id);
    if (!statuses.includes(strategy.status)) throw new Error("strategy status is invalid");
    finite(strategy.todaysPnl, "todaysPnl"); finite(strategy.totalPnl, "totalPnl"); nonNegative(strategy.drawdown, "drawdown"); nonNegative(strategy.capitalUsage, "capitalUsage"); nonNegative(strategy.errorCount, "errorCount");
    if (strategy.winRate < 0 || strategy.winRate > 1) throw new Error("winRate must be between 0 and 1");
    if (strategy.confidence !== null && (strategy.confidence < 0 || strategy.confidence > 1)) throw new Error("confidence must be between 0 and 1");
    for (const value of [strategy.profitFactor, strategy.sharpeRatio, strategy.recoveryFactor, strategy.stability]) if (value !== null) finite(value, "strategy metric");
    for (const value of [strategy.config.positionSize, strategy.config.riskPercent, strategy.config.maxDailyLoss, strategy.config.maxExposure]) nonNegative(value, "strategy configuration");
    for (const value of [strategy.config.stopLoss, strategy.config.takeProfit]) if (value !== null) nonNegative(value, "strategy configuration");
    for (const value of [strategy.lastTradeAt, strategy.nextEvaluationAt]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error("strategy timestamp is invalid");
  }
}

export function buildStrategyManagementScreen(input: StrategyManagementInput): StrategyManagementState {
  validate(input);
  const strategies = Object.freeze([...input.strategies]);
  const active = strategies.filter((strategy) => strategy.status === "RUNNING" || strategy.status === "WAITING").length;
  const paused = strategies.filter((strategy) => strategy.status === "PAUSED").length;
  const totalProfit = strategies.reduce((sum, strategy) => sum + strategy.totalPnl, 0);
  const positiveProfit = strategies.reduce((sum, strategy) => sum + Math.max(0, strategy.totalPnl), 0);
  const overallHealth: StrategyHealth = strategies.some((strategy) => strategy.health === "ACTION_REQUIRED" || strategy.status === "ERROR") ? "ACTION_REQUIRED" : strategies.some((strategy) => strategy.health === "ATTENTION") ? "ATTENTION" : strategies.length ? "HEALTHY" : "UNKNOWN";
  const selected = input.selectedStrategyId ? strategies.find((strategy) => strategy.id === input.selectedStrategyId) : undefined;
  const controls = freeze({ start: selected != null && ["PAUSED", "DISABLED", "ERROR"].includes(selected.status), pause: selected?.status === "RUNNING" || selected?.status === "WAITING", resume: selected?.status === "PAUSED", stop: selected != null && selected.status !== "DISABLED", duplicate: selected != null, export: selected != null, archive: selected != null && selected.status !== "RUNNING" });
  const comparison = Object.freeze([...strategies].sort((left, right) => { const pnlOrder = right.totalPnl - left.totalPnl; if (pnlOrder !== 0) return pnlOrder; const stabilityOrder = (right.stability ?? -Infinity) - (left.stability ?? -Infinity); return stabilityOrder !== 0 ? stabilityOrder : left.id.localeCompare(right.id); }));
  const best = comparison[0]?.id ?? null;
  const weakest = comparison.at(-1)?.id ?? null;
  const suggestedPause = strategies.find((strategy) => strategy.status === "ERROR" || strategy.health === "ACTION_REQUIRED" || strategy.totalPnl < 0 && strategy.drawdown > 0.1)?.id ?? null;
  const confidenceValues = strategies.map((strategy) => strategy.confidence).filter((value): value is number => value !== null);
  return freeze({ ...input, strategies, header: freeze({ active, paused, totalProfit, portfolioContribution: positiveProfit === 0 ? 0 : Math.max(0, totalProfit) / positiveProfit, overallHealth }), comparison, controls, batchControls: freeze({ pause: active > 0, resume: paused > 0, stop: strategies.some((strategy) => strategy.status !== "DISABLED"), confirmationRequired: true as const }), aiAssistant: freeze({ best, weakest, suggestedPause, suggestedOptimization: best ? `Review capital allocation and risk limits for ${best} using verified performance.` : null, confidenceTrend: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : null, autoApply: false as const }), ...(strategies.length ? {} : { emptyState: freeze({ create: true as const, import: true as const, templates: true as const, documentation: true as const }) }) });
}
