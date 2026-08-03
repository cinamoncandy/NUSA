import type { Balance, Order, PlaceOrderRequest, Position, TradingService, TradingSnapshot } from "./tradingService";

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

export interface PortfolioStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

const freezePortfolioSummary = (summary: PortfolioSummary): PortfolioSummary => Object.freeze({
  ...summary,
  assets: Object.freeze(summary.assets.map((asset) => Object.freeze({ ...asset }))),
});

const validatePortfolioSummary = (value: unknown): PortfolioSummary => {
  if (!value || typeof value !== "object") throw new Error("portfolio summary must be an object");
  const summary = value as Partial<PortfolioSummary>;
  if (typeof summary.quoteCurrency !== "string" || !summary.quoteCurrency.trim()) throw new Error("portfolio quote currency is invalid");
  for (const field of ["cash", "assetValue", "equity", "realizedPnl", "unrealizedPnl", "totalPnl"] as const) {
    if (typeof summary[field] !== "number" || !Number.isFinite(summary[field])) throw new Error(`portfolio ${field} is invalid`);
  }
  if (!Array.isArray(summary.assets)) throw new Error("portfolio assets are invalid");
  for (const asset of summary.assets) {
    if (!asset || typeof asset !== "object" || typeof asset.market !== "string" || !asset.market.trim()) throw new Error("portfolio asset is invalid");
    for (const field of ["quantity", "averageEntryPrice", "currentPrice", "marketValue", "unrealizedPnl", "realizedPnl"] as const) {
      if (typeof asset[field] !== "number" || !Number.isFinite(asset[field])) throw new Error(`portfolio asset ${field} is invalid`);
    }
  }
  return freezePortfolioSummary(summary as PortfolioSummary);
};

export class MockPortfolioRepository implements PortfolioRepository {
  private value: PortfolioSummary | null = null;

  public async load(): Promise<PortfolioSummary | null> { return this.value ? validatePortfolioSummary(this.value) : null; }
  public async save(summary: PortfolioSummary): Promise<void> { this.value = validatePortfolioSummary(summary); }
}

export class JsonPortfolioRepository implements PortfolioRepository {
  public constructor(private readonly storage: PortfolioStorage, private readonly key = "nusa.portfolio.summary.v1") {}

  public async load(): Promise<PortfolioSummary | null> {
    const raw = await this.storage.read(this.key);
    if (raw === null) return null;
    try {
      return validatePortfolioSummary(JSON.parse(raw));
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`portfolio persistence is invalid${reason}`);
    }
  }

  public async save(summary: PortfolioSummary): Promise<void> {
    await this.storage.write(this.key, JSON.stringify(validatePortfolioSummary(summary)));
  }
}

export interface PortfolioSyncResult {
  readonly order: Order;
  readonly portfolio: PortfolioSummary;
}

export class PortfolioSyncService {
  public constructor(private readonly trading: TradingService, private readonly repository: PortfolioRepository, private readonly quoteCurrency = "KRW") {}

  public async sync(currentPrices: ReadonlyMap<string, number>): Promise<PortfolioSummary> {
    const snapshot = await this.trading.getSnapshot();
    const summary = buildPortfolioSummary(snapshot, currentPrices, this.quoteCurrency);
    await this.repository.save(summary);
    return summary;
  }

  public restore(): Promise<PortfolioSummary | null> {
    return this.repository.load();
  }

  public async placePaperOrderAndSync(request: PlaceOrderRequest, currentPrices: ReadonlyMap<string, number>): Promise<PortfolioSyncResult> {
    const order = await this.trading.placePaperOrder(request);
    if (order.status !== "FILLED") throw new Error("portfolio sync requires a filled order");
    return Object.freeze({ order, portfolio: await this.sync(currentPrices) });
  }
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
