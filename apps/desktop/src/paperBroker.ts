export type PaperSide = "BUY" | "SELL";

export interface PaperOrder {
  id: string;
  market: string;
  side: PaperSide;
  quantity: number;
  price: number;
  fee: number;
  filledAt: string;
}

export interface PaperPosition {
  market: string;
  quantity: number;
  averagePrice: number;
  realizedPnl: number;
}

export interface PaperAccountSnapshot {
  cash: number;
  equity: number;
  unrealizedPnl: number;
  position: PaperPosition;
  orders: readonly PaperOrder[];
}

export class PaperBroker {
  private cash: number;
  private readonly feeRate: number;
  private readonly position: PaperPosition;
  private readonly orders: PaperOrder[] = [];

  constructor(initialCash = 10_000_000, market = "KRW-BTC", feeRate = 0.0005) {
    if (!Number.isFinite(initialCash) || initialCash <= 0) throw new Error("initialCash must be positive");
    if (!Number.isFinite(feeRate) || feeRate < 0) throw new Error("feeRate must be non-negative");
    this.cash = initialCash;
    this.feeRate = feeRate;
    this.position = { market, quantity: 0, averagePrice: 0, realizedPnl: 0 };
  }

  execute(side: PaperSide, quantity: number, price: number, now = new Date()): PaperOrder {
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be positive");
    if (!Number.isFinite(price) || price <= 0) throw new Error("price must be positive");

    const notional = quantity * price;
    const fee = notional * this.feeRate;

    if (side === "BUY") {
      if (notional + fee > this.cash) throw new Error("insufficient paper cash");
      const previousCost = this.position.quantity * this.position.averagePrice;
      this.cash -= notional + fee;
      this.position.quantity += quantity;
      this.position.averagePrice = (previousCost + notional) / this.position.quantity;
    } else {
      if (quantity > this.position.quantity) throw new Error("insufficient paper position");
      const pnl = (price - this.position.averagePrice) * quantity - fee;
      this.cash += notional - fee;
      this.position.quantity -= quantity;
      this.position.realizedPnl += pnl;
      if (this.position.quantity === 0) this.position.averagePrice = 0;
    }

    const order: PaperOrder = Object.freeze({
      id: `${now.getTime()}-${this.orders.length + 1}`,
      market: this.position.market,
      side,
      quantity,
      price,
      fee,
      filledAt: now.toISOString()
    });
    this.orders.unshift(order);
    return order;
  }

  snapshot(markPrice: number): PaperAccountSnapshot {
    if (!Number.isFinite(markPrice) || markPrice <= 0) throw new Error("markPrice must be positive");
    const marketValue = this.position.quantity * markPrice;
    const unrealizedPnl = this.position.quantity * (markPrice - this.position.averagePrice);
    return Object.freeze({
      cash: this.cash,
      equity: this.cash + marketValue,
      unrealizedPnl,
      position: Object.freeze({ ...this.position }),
      orders: Object.freeze([...this.orders])
    });
  }
}
