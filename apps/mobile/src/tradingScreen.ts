export type TradingOrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | "TAKE_PROFIT" | "STOP_LOSS";
export type ValidationStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface TradingScreenInput {
  readonly mode: "PAPER" | "STOPPED" | "FAULTED";
  readonly market: string;
  readonly regime: string | null;
  readonly connection: "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "UNKNOWN";
  readonly strategy: "RUNNING" | "PAUSED" | "WAITING" | "STOPPED";
  readonly price: number | null;
  readonly change24h: number | null;
  readonly volume24h: number | null;
  readonly spread: number | null;
  readonly fundingRate?: number;
  readonly position?: {
    readonly quantity: number;
    readonly entryPrice: number;
    readonly currentPrice: number;
    readonly unrealizedPnl: number;
    readonly realizedPnl: number;
    readonly size: number;
  };
  readonly order?: {
    readonly side: "BUY" | "SELL";
    readonly type: TradingOrderType;
    readonly quantity: number;
    readonly price: number | null;
    readonly estimatedFee: number | null;
    readonly maximumLoss: number | null;
    readonly expectedReward: number | null;
    readonly riskReward: number | null;
  };
  readonly availableBalance: number | null;
  readonly validation: Readonly<Record<"marketDataFresh" | "riskEngine" | "sufficientBalance" | "positionLimits" | "dailyLossLimit" | "duplicateOrder" | "network", ValidationStatus>>;
  readonly supportedOrderTypes: readonly TradingOrderType[];
  readonly postTrade?: {
    readonly orderStatus: "ACCEPTED" | "REJECTED" | "UNKNOWN";
    readonly fillStatus: "FILLED" | "PARTIAL" | "PENDING" | "NONE";
    readonly ledgerStatus: "UPDATED" | "PENDING" | "UNKNOWN";
    readonly positionStatus: "UPDATED" | "UNCHANGED" | "UNKNOWN";
    readonly riskStatus: "UPDATED" | "BLOCKED" | "UNKNOWN";
    readonly recoveryAction?: string;
  };
}

export interface TradingScreenState {
  readonly header: Pick<TradingScreenInput, "market" | "regime" | "connection" | "strategy" | "mode">;
  readonly price: Pick<TradingScreenInput, "price" | "change24h" | "volume24h" | "spread" | "fundingRate">;
  readonly position: TradingScreenInput["position"];
  readonly order: TradingScreenInput["order"];
  readonly availableBalance: number | null;
  readonly supportedOrderTypes: readonly TradingOrderType[];
  readonly validation: TradingScreenInput["validation"];
  readonly canSubmit: boolean;
  readonly disabledReasons: readonly string[];
  readonly confirmation?: {
    readonly side: "BUY" | "SELL";
    readonly quantity: number;
    readonly price: number | null;
    readonly estimatedFee: number | null;
    readonly maximumRisk: number | null;
    readonly expectedReward: number | null;
    readonly riskReward: number | null;
    readonly mode: "PAPER";
  };
  readonly postTrade?: TradingScreenInput["postTrade"];
  readonly emergencyStopVisible: true;
  readonly recoveryAction?: string;
}

const STATUS_KEYS: readonly (keyof TradingScreenInput["validation"])[] = ["marketDataFresh", "riskEngine", "sufficientBalance", "positionLimits", "dailyLossLimit", "duplicateOrder", "network"];
const REASONS: Readonly<Record<string, string>> = Object.freeze({ marketDataFresh: "시장 데이터가 최신이 아닙니다.", riskEngine: "Risk 검증을 통과하지 못했습니다.", sufficientBalance: "사용 가능 잔고가 부족합니다.", positionLimits: "포지션 한도 확인이 필요합니다.", dailyLossLimit: "일일 손실 한도가 차단했습니다.", duplicateOrder: "중복 주문 확인이 필요합니다.", network: "네트워크 연결을 확인할 수 없습니다." });
const finiteOrNull = (value: number | null | undefined, name: string): void => { if (value !== null && value !== undefined && !Number.isFinite(value)) throw new Error(`${name} must be finite or null`); };

export function buildTradingScreen(input: TradingScreenInput): TradingScreenState {
  if (!input.market.trim()) throw new Error("market is required");
  finiteOrNull(input.price, "price"); finiteOrNull(input.change24h, "change24h"); finiteOrNull(input.volume24h, "volume24h"); finiteOrNull(input.spread, "spread"); finiteOrNull(input.fundingRate, "fundingRate"); finiteOrNull(input.availableBalance, "availableBalance");
  if (input.availableBalance !== null && input.availableBalance !== undefined && input.availableBalance < 0) throw new Error("availableBalance must be non-negative");
  const supported = Object.freeze([...input.supportedOrderTypes]);
  const disabledReasons = STATUS_KEYS.flatMap((key) => input.validation[key] === "PASS" ? [] : [input.validation[key] === "UNKNOWN" ? `${REASONS[key]} 상태를 확인할 수 없습니다.` : REASONS[key]!]);
  if (input.mode !== "PAPER") disabledReasons.push("Paper Trading 상태가 아닙니다.");
  if (input.order && !supported.includes(input.order.type)) disabledReasons.push("이 주문 유형은 현재 지원되지 않습니다.");
  const canSubmit = input.order !== undefined && disabledReasons.length === 0;
  const confirmation = canSubmit ? Object.freeze({ side: input.order!.side, quantity: input.order!.quantity, price: input.order!.price, estimatedFee: input.order!.estimatedFee, maximumRisk: input.order!.maximumLoss, expectedReward: input.order!.expectedReward, riskReward: input.order!.riskReward, mode: "PAPER" as const }) : undefined;
  const recoveryAction = input.postTrade?.orderStatus === "UNKNOWN" || input.postTrade?.ledgerStatus === "UNKNOWN" || input.postTrade?.positionStatus === "UNKNOWN" ? input.postTrade.recoveryAction ?? "주문 기록과 Ledger를 확인한 뒤 재시도하세요." : undefined;
  return Object.freeze({ header: Object.freeze({ market: input.market, regime: input.regime, connection: input.connection, strategy: input.strategy, mode: input.mode }), price: Object.freeze({ price: input.price, change24h: input.change24h, volume24h: input.volume24h, spread: input.spread, fundingRate: input.fundingRate }), position: input.position, order: input.order, availableBalance: input.availableBalance ?? null, supportedOrderTypes: supported, validation: input.validation, canSubmit, disabledReasons: Object.freeze(disabledReasons), ...(confirmation ? { confirmation } : {}), ...(input.postTrade ? { postTrade: input.postTrade } : {}), emergencyStopVisible: true, ...(recoveryAction ? { recoveryAction } : {}) });
}
