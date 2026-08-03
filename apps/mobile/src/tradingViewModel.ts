export type TradingOrderSide = "BUY" | "SELL";
export type TradingOrderType = "MARKET" | "LIMIT";

export interface TradingMarketInput {
  readonly market: string;
  readonly connectionState: string;
  readonly stale: boolean;
  readonly price: number | null;
}

export interface TradingAccountInput {
  readonly mode: "PAPER" | "SHADOW";
  readonly liveMutationAllowed: boolean;
  readonly cash: number;
  readonly assetQuantity: number;
  readonly market: string;
}

export interface TradingDraft {
  readonly side: TradingOrderSide;
  readonly orderType: TradingOrderType;
  readonly priceInput: string;
  readonly quantityInput: string;
}

export interface TradingViewModel {
  readonly market: string;
  readonly currentPrice: number | null;
  readonly side: TradingOrderSide;
  readonly orderType: TradingOrderType;
  readonly price: number | null;
  readonly quantity: number | null;
  readonly estimatedNotional: number | null;
  readonly availableAmount: number;
  readonly availableUnit: string;
  readonly validationErrors: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly safetyApproved: boolean;
  readonly canSubmit: boolean;
}

const READY_CONNECTIONS = new Set(["CONNECTED", "HEALTHY"]);

function positiveInput(value: string, field: string, errors: string[]): number | null {
  if (value.trim() === "") {
    errors.push(`${field} is required`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${field} must be positive`);
    return null;
  }
  return parsed;
}

function nonNegative(value: number, field: string, errors: string[]): number {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${field} is invalid`);
    return 0;
  }
  return value;
}

function assetCode(market: string): string {
  return market.split("-")[1] ?? market.split("/")[1] ?? "ASSET";
}

export function buildTradingViewModel(input: {
  readonly market: TradingMarketInput;
  readonly account: TradingAccountInput;
  readonly draft: TradingDraft;
  readonly submitAvailable?: boolean;
}): TradingViewModel {
  const errors: string[] = [];
  const blockedReasons: string[] = [];
  const marketName = input.market.market.trim();
  const currentPrice = input.market.price;
  const cash = nonNegative(input.account.cash, "cash", errors);
  const assetQuantity = nonNegative(input.account.assetQuantity, "asset quantity", errors);
  const availableAmount = input.draft.side === "BUY" ? cash : assetQuantity;
  const availableUnit = input.draft.side === "BUY" ? "KRW" : assetCode(marketName);

  if (!marketName || marketName !== input.account.market.trim()) errors.push("market is unavailable");
  if (!READY_CONNECTIONS.has(input.market.connectionState) || input.market.stale) blockedReasons.push("MARKET_DATA_NOT_READY");
  if (!Number.isFinite(currentPrice) || currentPrice === null || currentPrice <= 0) blockedReasons.push("PRICE_NOT_RECEIVED");
  if (input.account.mode !== "PAPER") blockedReasons.push("PAPER_MODE_REQUIRED");
  if (input.account.liveMutationAllowed) blockedReasons.push("LIVE_MUTATION_DISABLED");

  const price = input.draft.orderType === "MARKET"
    ? (Number.isFinite(currentPrice) && currentPrice !== null && currentPrice > 0 ? currentPrice : null)
    : positiveInput(input.draft.priceInput, "price", errors);
  const quantity = positiveInput(input.draft.quantityInput, "quantity", errors);
  const estimatedNotional = price !== null && quantity !== null ? price * quantity : null;

  if (estimatedNotional !== null && !Number.isFinite(estimatedNotional)) errors.push("estimated amount is invalid");
  if (input.draft.side === "BUY" && estimatedNotional !== null && estimatedNotional > cash) errors.push("insufficient available cash");
  if (input.draft.side === "SELL" && quantity !== null && quantity > assetQuantity) errors.push("insufficient available asset");

  const safetyApproved = errors.length === 0 && blockedReasons.length === 0;
  const canSubmit = safetyApproved && input.submitAvailable === true;
  if (!canSubmit && safetyApproved) blockedReasons.push("ORDER_SUBMISSION_NOT_CONNECTED");

  return Object.freeze({
    market: marketName,
    currentPrice,
    side: input.draft.side,
    orderType: input.draft.orderType,
    price,
    quantity,
    estimatedNotional,
    availableAmount,
    availableUnit,
    validationErrors: Object.freeze([...errors]),
    blockedReasons: Object.freeze([...blockedReasons]),
    safetyApproved,
    canSubmit,
  });
}

export function formatTradingAmount(value: number | null, unit: string): string {
  if (value === null) return "-";
  const formatted = unit === "KRW"
    ? Math.round(value).toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return `${unit} ${formatted}`;
}

export function tradingAssetCode(market: string): string {
  return assetCode(market);
}
