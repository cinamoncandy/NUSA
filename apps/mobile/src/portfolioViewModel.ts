export interface PortfolioAccountSnapshot {
  readonly available?: boolean;
  readonly reason?: string;
  readonly cash: number;
  readonly equity: number;
  readonly unrealizedPnl: number;
  readonly markPrice: number;
  readonly position: Readonly<{
    readonly market: string;
    readonly quantity: number;
    readonly averagePrice: number;
    readonly realizedPnl: number;
  }>;
}

export interface PortfolioAccountResponse {
  readonly observedAt: string;
  readonly mode: "PAPER" | "SHADOW";
  readonly account: PortfolioAccountSnapshot;
  readonly openOrderCount: number;
}

export interface PortfolioViewModel {
  readonly totalEquity: number;
  readonly cash: number;
  readonly assetValue: number;
  readonly totalPnl: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly returnRate: number | null;
  readonly position: Readonly<{
    readonly market: string;
    readonly quantity: number;
    readonly averagePrice: number;
    readonly currentPrice: number;
    readonly unrealizedPnl: number;
    readonly realizedPnl: number;
  }> | null;
  readonly openOrderCount: number;
}

const finite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};

const nonNegative = (value: number, field: string): void => {
  finite(value, field);
  if (value < 0) throw new Error(`${field} must be non-negative`);
};

export function buildPortfolioViewModel(response: PortfolioAccountResponse): PortfolioViewModel {
  if (response.account.available === false) throw new Error(response.account.reason ?? "portfolio data unavailable");
  nonNegative(response.account.cash, "cash");
  nonNegative(response.account.equity, "equity");
  finite(response.account.unrealizedPnl, "unrealizedPnl");
  if (!Number.isFinite(response.account.markPrice) || response.account.markPrice <= 0) throw new Error("markPrice must be positive");
  if (!response.account.position.market.trim()) throw new Error("position market is required");
  nonNegative(response.account.position.quantity, "position.quantity");
  nonNegative(response.account.position.averagePrice, "position.averagePrice");
  finite(response.account.position.realizedPnl, "position.realizedPnl");
  nonNegative(response.openOrderCount, "openOrderCount");

  const assetValue = response.account.position.quantity * response.account.markPrice;
  finite(assetValue, "assetValue");
  const tolerance = Math.max(1e-6, response.account.equity * 1e-9);
  if (Math.abs(response.account.cash + assetValue - response.account.equity) > tolerance) throw new Error("portfolio totals do not reconcile");

  const position = response.account.position.quantity > 0
    ? Object.freeze({
      market: response.account.position.market,
      quantity: response.account.position.quantity,
      averagePrice: response.account.position.averagePrice,
      currentPrice: response.account.markPrice,
      unrealizedPnl: response.account.unrealizedPnl,
      realizedPnl: response.account.position.realizedPnl,
    })
    : null;
  return Object.freeze({
    totalEquity: response.account.equity,
    cash: response.account.cash,
    assetValue,
    totalPnl: response.account.unrealizedPnl + response.account.position.realizedPnl,
    realizedPnl: response.account.position.realizedPnl,
    unrealizedPnl: response.account.unrealizedPnl,
    returnRate: null,
    position,
    openOrderCount: response.openOrderCount,
  });
}
