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
  quantityStep?: number;
  dustThreshold?: number;
}

interface NormalizedPaperRiskPolicy {
  readonly maxOrderNotional?: number;
  readonly maxPositionQuantity?: number;
  readonly maxRealizedLoss?: number;
  readonly quantityStep: number;
  readonly dustThreshold: number;
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

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1] ?? 0);
  return (text.split(".")[1] ?? "").length;
}

function floorToStep(value: number, step: number): number {
  const precision = Math.min(15, Math.max(decimalPlaces(step), 0));
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toFixed(precision));
}

export class PaperBroker {
  private cash: number;
  private readonly feeRate: number;
  private readonly position: PaperPosition;
  private readonly orders: PaperOrder[];
  private readonly riskPolicy: NormalizedPaperRiskPolicy;

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

    const quantityStep = riskPolicy.quantityStep ?? 0.00000001;
    const dustThreshold = riskPolicy.dustThreshold ?? quantityStep / 2;
    if (!Number.isFinite(quantityStep) || quantityStep <= 0) throw new Error("quantityStep must be positive");
    assertFiniteNonNegative(dustThreshold, "dustThreshold");
    if (dustThreshold >= quantityStep) throw new Error("dustThreshold must be smaller than quantityStep");

    this.riskPolicy = Object.freeze({
      ...(riskPolicy.maxOrderNotional == null ? {} : { maxOrderNotional: riskPolicy.maxOrderNotional }),
      ...(riskPolicy.maxPositionQuantity == null ? {} : { maxPositionQuantity: riskPolicy.maxPositionQuantity }),
      ...(riskPolicy.maxRealizedLoss == null ? {} : { maxRealizedLoss: riskPolicy.maxRealizedLoss }),
      quantityStep,
      dustThreshold
    });

    if (restoredState) {
      if (restoredState.version !== 1) throw new Error("unsupported paper broker state version");
      if (restoredState.position.market !== market) throw new Error("paper state market mismatch");
      if (restoredState.feeRate !== feeRate) throw new Error("paper state fee rate mismatch");
      this.cash = restoredState.cash;
      this.feeRate = restoredState.feeRate;
      this.position = { ...restoredState.position };
      this.position.quantity = this.normalizePositionQuantity(this.position.quantity);
      if (this.position.quantity === 0) this.position.averagePrice = 0;
      this.orders = restoredState.orders.map((order) => ({ ...order }));
    } else {
      this.cash = initialCash;
      this.feeRate = feeRate;
      this.position = { market, quantity: 0, averagePrice: 0, realizedPnl: 0 };
      this.orders = [];
    }
  }

  private normalizeOrderQuantity(quantity: number): number {
    const normalized = floorToStep(quantity, this.riskPolicy.quantityStep);
    if (normalized <= this.riskPolicy.dustThreshold) throw new Error("quantity is below market step or dust threshold");
    return normalized;
  }

  private normalizePositionQuantity(quantity: number): number {
    if (quantity <= this.riskPolicy.dustThreshold) return 0;
    return floorToStep(quantity, this.riskPolicy.quantityStep);
  }

  execute(side: PaperSide, quantity: number, price: number, now = new Date()): PaperOrder {
    if (side !== "BUY" && side !== "SELL") throw new Error("invalid paper side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be positive");
    if (!Number.isFinite(price) || price <= 0) throw new Error("price must be positive");

    const normalizedQuantity = this.normalizeOrderQuantity(quantity);
    const notional = normalizedQuantity * price;
    let chargedFee = notional * this.feeRate;

    if (side === "SELL" && normalizedQuantity - this.position.quantity > this.riskPolicy.dustThreshold) {
      throw new Error("insufficient paper position");
    }
    if (this.riskPolicy.maxOrderNotional != null && notional > this.riskPolicy.maxOrderNotional) {
      throw new Error("paper risk: max order notional exceeded");
    }
    if (this.riskPolicy.maxRealizedLoss != null && this.position.realizedPnl < -this.riskPolicy.maxRealizedLoss) {
      throw new Error("paper risk: max realized loss exceeded");
    }

    if (side === "BUY") {
      const nextQuantity = this.normalizePositionQuantity(this.position.quantity + normalizedQuantity);
      if (this.riskPolicy.maxPositionQuantity != null && nextQuantity > this.riskPolicy.maxPositionQuantity) {
        throw new Error("paper risk: max position quantity exceeded");
      }
      if (notional + chargedFee > this.cash) throw new Error("insufficient paper cash");
      const previousCost = this.position.quantity * this.position.averagePrice;
      this.cash -= notional + chargedFee;
      this.position.quantity = nextQuantity;
      this.position.averagePrice = (previousCost + notional) / this.position.quantity;
    } else {
      const sellQuantity = Math.min(normalizedQuantity, this.position.quantity);
      const sellNotional = sellQuantity * price;
      chargedFee = sellNotional * this.feeRate;
      const pnl = (price - this.position.averagePrice) * sellQuantity - chargedFee;
      this.cash += sellNotional - chargedFee;
      this.position.quantity = this.normalizePositionQuantity(this.position.quantity - sellQuantity);
      this.position.realizedPnl += pnl;
      if (this.position.quantity === 0) this.position.averagePrice = 0;
    }

    const order: PaperOrder = Object.freeze({
      id: `${now.getTime()}-${this.orders.length + 1}`,
      market: this.position.market,
      side,
      quantity: normalizedQuantity,
      price,
      fee: chargedFee,
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

  restoreState(state: PaperBrokerState): void {
    const validated = new PaperBroker(1, this.position.market, this.feeRate, this.riskPolicy, state).exportState();
    this.cash = validated.cash;
    this.position.quantity = validated.position.quantity;
    this.position.averagePrice = validated.position.averagePrice;
    this.position.realizedPnl = validated.position.realizedPnl;
    this.orders.splice(0, this.orders.length, ...validated.orders.map((order) => ({ ...order })));
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
