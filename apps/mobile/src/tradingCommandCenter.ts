export type CommandHealth = "HEALTHY" | "ATTENTION" | "ACTION_REQUIRED" | "UNKNOWN";
export type StrategyState = "RUNNING" | "PAUSED" | "WAITING" | "STOPPED";

export interface CommandCenterInput {
  readonly generatedAt: number;
  readonly mode: "PAPER" | "STOPPED" | "FAULTED";
  readonly account: {
    readonly totalEquity: number;
    readonly availableCapital: number;
    readonly reservedCapital: number;
    readonly todaysPnl: number;
  };
  readonly market: {
    readonly regime: string | null;
    readonly health: CommandHealth;
    readonly watchlist: readonly { readonly market: string; readonly price: number | null; readonly changeRate: number | null }[];
  };
  readonly positions: readonly { readonly market: string; readonly pnl: number | null; readonly size: number; readonly risk: CommandHealth; readonly durationMs: number | null }[];
  readonly strategy: { readonly state: StrategyState; readonly lastSignal: string | null; readonly confidence: number | null };
  readonly risk: { readonly dailyLoss: number; readonly exposure: number; readonly riskBudget: number; readonly health: CommandHealth; readonly warnings: readonly string[]; readonly emergencyActive: boolean };
  readonly systems: Readonly<Record<"TRADING_ENGINE" | "MARKET_DATA" | "WEBSOCKET" | "LEDGER" | "RECOVERY" | "AI", CommandHealth>>;
  readonly activity: readonly { readonly type: "ORDER" | "EXECUTION" | "RECOVERY" | "ERROR" | "NOTIFICATION"; readonly message: string; readonly occurredAt: number }[];
}

export interface TradingCommandCenter {
  readonly generatedAt: number;
  readonly mode: "PAPER" | "STOPPED" | "FAULTED";
  readonly account: CommandCenterInput["account"];
  readonly market: CommandCenterInput["market"];
  readonly positions: CommandCenterInput["positions"];
  readonly strategy: CommandCenterInput["strategy"];
  readonly risk: CommandCenterInput["risk"];
  readonly systems: CommandCenterInput["systems"];
  readonly activity: CommandCenterInput["activity"];
  readonly health: CommandHealth;
  readonly quickActions: Readonly<Record<"BUY" | "SELL" | "CLOSE_POSITION" | "PAUSE_STRATEGY" | "RESUME_STRATEGY" | "EMERGENCY_STOP", boolean>>;
  readonly emptyStates: Readonly<Record<"PORTFOLIO" | "POSITIONS" | "STRATEGY", string | undefined>>;
}

const HEALTH_ORDER: readonly CommandHealth[] = ["UNKNOWN", "HEALTHY", "ATTENTION", "ACTION_REQUIRED"];
const validHealth = (value: CommandHealth): boolean => HEALTH_ORDER.includes(value);
const assertFinite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const assertNonNegative = (value: number, name: string): void => { assertFinite(value, name); if (value < 0) throw new Error(`${name} must be non-negative`); };

export function buildTradingCommandCenter(input: CommandCenterInput): TradingCommandCenter {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  for (const [name, value] of Object.entries(input.account)) assertFinite(value as number, `account.${name}`);
  if (input.account.availableCapital < 0 || input.account.reservedCapital < 0 || input.account.availableCapital + input.account.reservedCapital > input.account.totalEquity) throw new Error("account capital does not reconcile");
  if (!validHealth(input.market.health) || !validHealth(input.risk.health)) throw new Error("invalid command health");
  for (const value of Object.values(input.systems)) if (!validHealth(value)) throw new Error("invalid system health");
  assertNonNegative(input.risk.dailyLoss, "risk.dailyLoss");
  assertNonNegative(input.risk.exposure, "risk.exposure");
  assertNonNegative(input.risk.riskBudget, "risk.riskBudget");
  if (input.strategy.confidence !== null && (input.strategy.confidence < 0 || input.strategy.confidence > 1)) throw new Error("strategy.confidence must be between 0 and 1");
  const systemHealth = Object.values(input.systems);
  const health = input.mode === "FAULTED" || input.risk.emergencyActive || systemHealth.includes("ACTION_REQUIRED") || input.risk.health === "ACTION_REQUIRED"
    ? "ACTION_REQUIRED"
    : systemHealth.includes("UNKNOWN") || input.market.health === "UNKNOWN" || input.risk.health === "UNKNOWN"
      ? "UNKNOWN"
      : systemHealth.includes("ATTENTION") || input.market.health === "ATTENTION" || input.risk.health === "ATTENTION"
        ? "ATTENTION" : "HEALTHY";
  const tradingReady = input.mode === "PAPER" && health !== "ACTION_REQUIRED" && health !== "UNKNOWN" && !input.risk.emergencyActive;
  const quickActions = Object.freeze({
    BUY: tradingReady,
    SELL: tradingReady && input.positions.length > 0,
    CLOSE_POSITION: tradingReady && input.positions.length > 0,
    PAUSE_STRATEGY: input.strategy.state === "RUNNING",
    RESUME_STRATEGY: input.strategy.state === "PAUSED" || input.strategy.state === "WAITING",
    EMERGENCY_STOP: input.mode !== "FAULTED" && !input.risk.emergencyActive
  });
  const emptyStates = Object.freeze({
    PORTFOLIO: input.account.totalEquity === 0 ? "첫 Paper 계정을 설정하세요." : undefined,
    POSITIONS: input.positions.length === 0 ? "보유 포지션이 없습니다. 마켓을 확인하세요." : undefined,
    STRATEGY: input.strategy.state === "STOPPED" && input.strategy.lastSignal === null ? "전략을 선택하고 Paper 신호를 확인하세요." : undefined
  });
  return Object.freeze({ generatedAt: input.generatedAt, mode: input.mode, account: Object.freeze({ ...input.account }), market: Object.freeze({ ...input.market, watchlist: Object.freeze([...input.market.watchlist]) }), positions: Object.freeze([...input.positions]), strategy: Object.freeze({ ...input.strategy }), risk: Object.freeze({ ...input.risk, warnings: Object.freeze([...input.risk.warnings]) }), systems: Object.freeze({ ...input.systems }), activity: Object.freeze([...input.activity]), health, quickActions, emptyStates });
}
