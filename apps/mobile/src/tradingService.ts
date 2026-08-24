import type { ApiClient } from "./apiClient";

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "FILLED" | "REJECTED";

export interface Order {
  readonly id: string;
  readonly market: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly price: number;
  readonly status: OrderStatus;
  readonly createdAtMs: number;
}

export interface Position {
  readonly market: string;
  readonly quantity: number;
  readonly averageEntryPrice: number;
}

export interface Balance {
  readonly currency: string;
  readonly available: number;
}

export interface TradingSnapshot {
  readonly orders: readonly Order[];
  readonly positions: readonly Position[];
  readonly balances: readonly Balance[];
}

export interface PlaceOrderRequest {
  readonly market: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly price: number;
  readonly nowMs: number;
}

export interface TradingService {
  getSnapshot(): Promise<TradingSnapshot>;
  placePaperOrder(request: PlaceOrderRequest): Promise<Order>;
}

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
};

const positive = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
};

const timestamp = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("nowMs must be a non-negative safe integer");
  return value;
};

const marketCurrencies = (market: string): Readonly<{ quote: string; base: string }> => {
  const separator = market.includes("/") ? "/" : market.includes("-") ? "-" : null;
  if (separator === null) throw new Error("market must contain base and quote currencies");
  const [quote, base, ...rest] = market.split(separator);
  if (!quote || !base || rest.length > 0) throw new Error("market must contain base and quote currencies");
  return Object.freeze({ quote, base });
};

const cloneSnapshot = (snapshot: TradingSnapshot): TradingSnapshot => Object.freeze({
  orders: Object.freeze(snapshot.orders.map((order) => Object.freeze({ ...order }))),
  positions: Object.freeze(snapshot.positions.map((position) => Object.freeze({ ...position }))),
  balances: Object.freeze(snapshot.balances.map((balance) => Object.freeze({ ...balance }))),
});

let latestObservedTradingSnapshot: TradingSnapshot | null = null;
const observedTradingListeners = new Set<() => void>();

function publishObservedTradingSnapshot(snapshot: TradingSnapshot): TradingSnapshot {
  const cloned = cloneSnapshot(snapshot);
  latestObservedTradingSnapshot = cloned;
  for (const listener of observedTradingListeners) listener();
  return cloned;
}

export function readObservedTradingSnapshot(): TradingSnapshot | null {
  return latestObservedTradingSnapshot;
}

export function subscribeObservedTradingSnapshot(listener: () => void): () => void {
  observedTradingListeners.add(listener);
  return () => observedTradingListeners.delete(listener);
}

export function resetObservedTradingSnapshotForTest(): void {
  latestObservedTradingSnapshot = null;
  for (const listener of observedTradingListeners) listener();
}

export class MockTradingService implements TradingService {
  private readonly orders: Order[] = [];
  private readonly positions = new Map<string, Position>();
  private readonly balances = new Map<string, Balance>();
  private nextOrderId = 1;

  public constructor(initialBalances: readonly Balance[] = [{ currency: "KRW", available: 0 }]) {
    for (const balance of initialBalances) {
      const currency = text(balance.currency, "currency");
      if (!Number.isFinite(balance.available) || balance.available < 0) throw new Error("available must be non-negative");
      if (this.balances.has(currency)) throw new Error(`duplicate balance: ${currency}`);
      this.balances.set(currency, Object.freeze({ currency, available: balance.available }));
    }
    publishObservedTradingSnapshot({ orders: this.orders, positions: [...this.positions.values()], balances: [...this.balances.values()] });
  }

  public async getSnapshot(): Promise<TradingSnapshot> {
    return publishObservedTradingSnapshot({ orders: this.orders, positions: [...this.positions.values()], balances: [...this.balances.values()] });
  }

  public async placePaperOrder(request: PlaceOrderRequest): Promise<Order> {
    const market = text(request.market, "market");
    const quantity = positive(request.quantity, "quantity");
    const price = positive(request.price, "price");
    const nowMs = timestamp(request.nowMs);
    const { base, quote } = marketCurrencies(market);
    const quoteBalance = this.balances.get(quote);
    const baseBalance = this.balances.get(base);
    const cost = quantity * price;
    if (request.side === "BUY") {
      if ((quoteBalance?.available ?? 0) < cost) throw new Error("insufficient quote balance");
      this.balances.set(quote, Object.freeze({ currency: quote, available: (quoteBalance?.available ?? 0) - cost }));
      this.balances.set(base, Object.freeze({ currency: base, available: (baseBalance?.available ?? 0) + quantity }));
      this.updatePosition(market, quantity, price);
    } else {
      if ((baseBalance?.available ?? 0) < quantity) throw new Error("insufficient base balance");
      this.balances.set(base, Object.freeze({ currency: base, available: (baseBalance?.available ?? 0) - quantity }));
      this.balances.set(quote, Object.freeze({ currency: quote, available: (quoteBalance?.available ?? 0) + cost }));
      this.reducePosition(market, quantity);
    }
    const order = Object.freeze({ id: `paper-${this.nextOrderId++}`, market, side: request.side, quantity, price, status: "FILLED" as const, createdAtMs: nowMs });
    this.orders.push(order);
    publishObservedTradingSnapshot({ orders: this.orders, positions: [...this.positions.values()], balances: [...this.balances.values()] });
    return order;
  }

  private updatePosition(market: string, quantity: number, price: number): void {
    const current = this.positions.get(market);
    const total = (current?.quantity ?? 0) + quantity;
    const average = (((current?.quantity ?? 0) * (current?.averageEntryPrice ?? 0)) + quantity * price) / total;
    this.positions.set(market, Object.freeze({ market, quantity: total, averageEntryPrice: average }));
  }

  private reducePosition(market: string, quantity: number): void {
    const current = this.positions.get(market);
    if (!current || current.quantity < quantity) throw new Error("insufficient position");
    const remaining = current.quantity - quantity;
    if (remaining === 0) this.positions.delete(market);
    else this.positions.set(market, Object.freeze({ ...current, quantity: remaining }));
  }
}

export class ApiTradingService implements TradingService {
  public constructor(private readonly api: ApiClient) {}

  public getSnapshot(): Promise<TradingSnapshot> {
    return this.api.get<TradingSnapshot>("/paper/trading/snapshot").then((response) => response.data);
  }

  public placePaperOrder(request: PlaceOrderRequest): Promise<Order> {
    return this.api.post<Order, PlaceOrderRequest>("/paper/trading/orders", request).then((response) => response.data);
  }
}
