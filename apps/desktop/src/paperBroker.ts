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

export interface PaperRiskPolicy {
  maxOrderNotional?: number;
  maxPositionQuantity?: number;
  maxRealizedLoss?: number;
}

export interface PaperBrokerState {
  version: 1;
  cash: number;
  feeRate: number;
  position: PaperPosition;
  orders: readonly PaperOrder[];
}

export interface PaperAccountSnapshot {
  cash: number;
  equity: number;
  unrealizedPnl: number;
  position: PaperPosition;
  orders: readonly PaperOrder[];
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
}

export class PaperBroker {
  private cash: number;
  private readonly feeRate: number;
  private readonly position: PaperPosition;
  private readonly orders: PaperOrder[];
  private readonly riskPolicy: PaperRiskPolicy;

  constructor(
    initialCash = 10_000_000,
    market = "KRW-BTC",
    feeRate = 0.0005,
    riskPolicy: PaperRiskPolicy = {},
    restoredState?: PaperBrokerState
  ) {
    if (!Number.isFinite(initialCash) || initialCash <= 0) throw new Error("initialCash must be positive");
    assertFiniteNonNegative(feeRate, "feeRate");
    if (riskPolicy.maxOrderNotional != null) assertFiniteNonNegative(riskPolicy.maxOrderNotional, "maxOrderNotional");
    if (riskPolicy.maxPositionQuantity != null) assertFiniteNonNegative(riskPolicy.maxPositionQuantity, "maxPositionQuantity");
    if (riskPolicy.maxRealizedLoss != null) assertFiniteNonNegative(riskPolicy.maxRealizedLoss, "maxRealizedLoss");

    this.riskPolicy = Object.freeze({ ...riskPolicy });
    if (restoredState) {
      if (restoredState.version !== 1) throw new Error("unsupported paper broker state version");
      if (restoredState.position.market !== market) throw new Error("paper state market mismatch");
      if (restoredState.feeRate !== feeRate) throw new Error("paper state fee rate mismatch");
      this.cash = restoredState.cash;
      this.feeRate = restoredState.feeRate;
      this.position = { ...restoredState.position };
      this.orders = restoredState.orders.map((order) => ({ ...order }));
    } else {
      this.cash = initialCash;
      this.feeRate = feeRate;
      this.position = { market, quantity: 0, averagePrice: 0, realizedPnl: 0 };
      this.orders = [];
    }
  }

  execute(side: PaperSide, quantity: number, price: number, now = new Date()): PaperOrder {
    if (side !== "BUY" && side !== "SELL") throw new Error("invalid paper side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be positive");
    if (!Number.isFinite(price) || price <= 0) throw new Error("price must be positive");

    const notional = quantity * price;
    const fee = notional * this.feeRate;
    if (side === "SELL" && quantity > this.position.quantity) {
      throw new Error("insufficient paper position");
    }
    if (this.riskPolicy.maxOrderNotional != null && notional > this.riskPolicy.maxOrderNotional) {
      throw new Error("paper risk: max order notional exceeded");
    }
    if (this.riskPolicy.maxRealizedLoss != null && this.position.realizedPnl < -this.riskPolicy.maxRealizedLoss) {
      throw new Error("paper risk: max realized loss exceeded");
    }

    if (side === "BUY") {
      const nextQuantity = this.position.quantity + quantity;
      if (this.riskPolicy.maxPositionQuantity != null && nextQuantity > this.riskPolicy.maxPositionQuantity) {
        throw new Error("paper risk: max position quantity exceeded");
      }
      if (notional + fee > this.cash) throw new Error("insufficient paper cash");
      const previousCost = this.position.quantity * this.position.averagePrice;
      this.cash -= notional + fee;
      this.position.quantity = nextQuantity;
      this.position.averagePrice = (previousCost + notional) / this.position.quantity;
    } else {
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

  exportState(): PaperBrokerState {
    return Object.freeze({
      version: 1 as const,
      cash: this.cash,
      feeRate: this.feeRate,
      position: Object.freeze({ ...this.position }),
      orders: Object.freeze(this.orders.map((order) => Object.freeze({ ...order })))
    });
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
