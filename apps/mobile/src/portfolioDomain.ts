import type { Balance, Position, TradingSnapshot } from "./tradingService";

export interface Asset {
  readonly market: string;
  readonly quantity: number;
  readonly averageEntryPrice: number;
  readonly currentPrice: number;
  readonly marketValue: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
}

export interface PortfolioSummary {
  readonly quoteCurrency: string;
  readonly cash: number;
  readonly assetValue: number;
  readonly equity: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly totalPnl: number;
  readonly assets: readonly Asset[];
}

export interface PortfolioRepository {
  load(): Promise<PortfolioSummary | null>;
  save(summary: PortfolioSummary): Promise<void>;
}

export class MockPortfolioRepository implements PortfolioRepository {
  private value: PortfolioSummary | null = null;

  public async load(): Promise<PortfolioSummary | null> { return this.value; }
  public async save(summary: PortfolioSummary): Promise<void> { this.value = summary; }
}

const finiteNonNegative = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and non-negative`);
  return value;
};

const positive = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
};

const availableCash = (balances: readonly Balance[], currency: string): number => {
  const balance = balances.find((item) => item.currency === currency);
  return finiteNonNegative(balance?.available ?? 0, `${currency}.available`);
};

const realizedPnlByMarket = (snapshot: TradingSnapshot): ReadonlyMap<string, number> => {
  const quantity = new Map<string, number>();
  const cost = new Map<string, number>();
  const realized = new Map<string, number>();
  for (const order of snapshot.orders) {
    const currentQuantity = quantity.get(order.market) ?? 0;
    const currentCost = cost.get(order.market) ?? 0;
    if (order.side === "BUY") {
      quantity.set(order.market, currentQuantity + order.quantity);
      cost.set(order.market, currentCost + order.quantity * order.price);
    } else {
      if (currentQuantity < order.quantity) throw new Error(`sell exceeds historical quantity for ${order.market}`);
      const average = currentQuantity === 0 ? 0 : currentCost / currentQuantity;
      quantity.set(order.market, currentQuantity - order.quantity);
      cost.set(order.market, currentCost - order.quantity * average);
      realized.set(order.market, (realized.get(order.market) ?? 0) + (order.price - average) * order.quantity);
    }
  }
  return realized;
};

export function buildPortfolioSummary(snapshot: TradingSnapshot, currentPrices: ReadonlyMap<string, number>, quoteCurrency = "KRW"): PortfolioSummary {
  const cash = availableCash(snapshot.balances, quoteCurrency);
  const realizedByMarket = realizedPnlByMarket(snapshot);
  const assets = snapshot.positions.map((position: Position): Asset => {
    const currentPrice = positive(currentPrices.get(position.market) ?? 0, `${position.market}.currentPrice`);
    const quantity = finiteNonNegative(position.quantity, `${position.market}.quantity`);
    const averageEntryPrice = finiteNonNegative(position.averageEntryPrice, `${position.market}.averageEntryPrice`);
    return Object.freeze({ market: position.market, quantity, averageEntryPrice, currentPrice, marketValue: quantity * currentPrice, unrealizedPnl: (currentPrice - averageEntryPrice) * quantity, realizedPnl: realizedByMarket.get(position.market) ?? 0 });
  });
  const assetValue = assets.reduce((total, asset) => total + asset.marketValue, 0);
  const realizedPnl = [...realizedByMarket.values()].reduce((total, value) => total + value, 0);
  const unrealizedPnl = assets.reduce((total, asset) => total + asset.unrealizedPnl, 0);
  return Object.freeze({ quoteCurrency, cash, assetValue, equity: cash + assetValue, realizedPnl, unrealizedPnl, totalPnl: realizedPnl + unrealizedPnl, assets: Object.freeze(assets) });
}
