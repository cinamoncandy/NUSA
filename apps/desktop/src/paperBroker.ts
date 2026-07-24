export type PaperSide = "BUY" | "SELL";

export interface PaperOrder {
  id: string;
  market: string;
  side: PaperSide;
  quantity: number;
  price: number;
  fee: number;
  filledAt: string;
  requestedQuantity: number;
  quotedPrice: number;
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
  /** Quoted price must be an exact multiple of this tick. Unset disables the check. */
  priceTick?: number;
  /** Minimum notional (quantity x fill price) a single order must reach. Unset disables the check. */
  minOrderNotional?: number;
}

interface NormalizedPaperRiskPolicy {
  readonly maxOrderNotional: number | null;
  readonly maxPositionQuantity: number | null;
  readonly maxRealizedLoss: number | null;
  readonly quantityStep: number;
  readonly dustThreshold: number;
  readonly priceTick: number | null;
  readonly minOrderNotional: number | null;
}

/**
 * Conservative Paper fill model. Every field defaults to a value that reproduces
 * exact, unslipped, fully-filled execution (the prior behavior), so existing
 * callers and persisted state are unaffected unless a caller opts in.
 */
export interface PaperFillModel {
  /** Adverse price movement applied against the trader, in basis points of the quoted price. */
  slippageBps?: number;
  /** Fraction (0, 1] of the requested quantity that can fill against one quote. The remainder is rejected, never queued or retried. */
  maxFillRatio?: number;
}

interface NormalizedPaperFillModel {
  readonly slippageBps: number;
  readonly maxFillRatio: number;
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
  const exponentMarker = text.indexOf("e-");
  if (exponentMarker >= 0) return Number(text.slice(exponentMarker + 2));
  const decimalMarker = text.indexOf(".");
  return decimalMarker < 0 ? 0 : text.length - decimalMarker - 1;
}

function floorToStep(value: number, step: number): number {
  const precision = Math.min(15, Math.max(decimalPlaces(step), 0));
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toFixed(precision));
}

function isAlignedToTick(value: number, tick: number): boolean {
  const units = value / tick;
  return Math.abs(units - Math.round(units)) < 1e-6;
}

export class PaperBroker {
  private cash: number;
  private readonly feeRate: number;
  private readonly position: PaperPosition;
  private readonly orders: PaperOrder[];
  private readonly riskPolicy: NormalizedPaperRiskPolicy;
  private readonly fillModel: NormalizedPaperFillModel;

  constructor(
    initialCash = 10_000_000,
    market = "KRW-BTC",
    feeRate = 0.0005,
    riskPolicy: PaperRiskPolicy = {},
    restoredState?: PaperBrokerState,
    fillModel: PaperFillModel = {}
  ) {
    if (!Number.isFinite(initialCash) || initialCash <= 0) throw new Error("initialCash must be positive");
    assertFiniteNonNegative(feeRate, "feeRate");
    if (riskPolicy.maxOrderNotional != null) assertFiniteNonNegative(riskPolicy.maxOrderNotional, "maxOrderNotional");
    if (riskPolicy.maxPositionQuantity != null) assertFiniteNonNegative(riskPolicy.maxPositionQuantity, "maxPositionQuantity");
    if (riskPolicy.maxRealizedLoss != null) assertFiniteNonNegative(riskPolicy.maxRealizedLoss, "maxRealizedLoss");
    if (riskPolicy.priceTick != null && (!Number.isFinite(riskPolicy.priceTick) || riskPolicy.priceTick <= 0)) {
      throw new Error("priceTick must be positive");
    }
    if (riskPolicy.minOrderNotional != null) assertFiniteNonNegative(riskPolicy.minOrderNotional, "minOrderNotional");

    const quantityStep = riskPolicy.quantityStep ?? 0.00000001;
    const dustThreshold = riskPolicy.dustThreshold ?? quantityStep / 2;
    if (!Number.isFinite(quantityStep) || quantityStep <= 0) throw new Error("quantityStep must be positive");
    assertFiniteNonNegative(dustThreshold, "dustThreshold");
    if (dustThreshold >= quantityStep) throw new Error("dustThreshold must be smaller than quantityStep");

    this.riskPolicy = Object.freeze({
      maxOrderNotional: riskPolicy.maxOrderNotional ?? null,
      maxPositionQuantity: riskPolicy.maxPositionQuantity ?? null,
      maxRealizedLoss: riskPolicy.maxRealizedLoss ?? null,
      quantityStep,
      dustThreshold,
      priceTick: riskPolicy.priceTick ?? null,
      minOrderNotional: riskPolicy.minOrderNotional ?? null
    });

    const slippageBps = fillModel.slippageBps ?? 0;
    const maxFillRatio = fillModel.maxFillRatio ?? 1;
    assertFiniteNonNegative(slippageBps, "slippageBps");
    if (!Number.isFinite(maxFillRatio) || maxFillRatio <= 0 || maxFillRatio > 1) {
      throw new Error("maxFillRatio must be in (0, 1]");
    }
    this.fillModel = Object.freeze({ slippageBps, maxFillRatio });

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
    if (this.riskPolicy.priceTick !== null && !isAlignedToTick(price, this.riskPolicy.priceTick)) {
      throw new Error("price does not align to tick size");
    }

    const liquidityLimitedQuantity = quantity * this.fillModel.maxFillRatio;
    const normalizedQuantity = this.normalizeOrderQuantity(liquidityLimitedQuantity);
    const fillPrice = side === "BUY"
      ? price * (1 + this.fillModel.slippageBps / 10_000)
      : price * (1 - this.fillModel.slippageBps / 10_000);
    const notional = normalizedQuantity * fillPrice;
    let chargedFee = notional * this.feeRate;

    if (side === "SELL" && normalizedQuantity - this.position.quantity > this.riskPolicy.dustThreshold) {
      throw new Error("insufficient paper position");
    }
    if (this.riskPolicy.maxOrderNotional !== null && notional > this.riskPolicy.maxOrderNotional) {
      throw new Error("paper risk: max order notional exceeded");
    }
    if (this.riskPolicy.minOrderNotional !== null && notional < this.riskPolicy.minOrderNotional) {
      throw new Error("notional is below minimum order notional");
    }
    if (this.riskPolicy.maxRealizedLoss !== null && this.position.realizedPnl < -this.riskPolicy.maxRealizedLoss) {
      throw new Error("paper risk: max realized loss exceeded");
    }

    if (side === "BUY") {
      const nextQuantity = this.normalizePositionQuantity(this.position.quantity + normalizedQuantity);
      if (this.riskPolicy.maxPositionQuantity !== null && nextQuantity > this.riskPolicy.maxPositionQuantity) {
        throw new Error("paper risk: max position quantity exceeded");
      }
      if (notional + chargedFee > this.cash) throw new Error("insufficient paper cash");
      const previousCost = this.position.quantity * this.position.averagePrice;
      this.cash -= notional + chargedFee;
      this.position.quantity = nextQuantity;
      this.position.averagePrice = (previousCost + notional) / this.position.quantity;
    } else {
      const sellQuantity = Math.min(normalizedQuantity, this.position.quantity);
      const sellNotional = sellQuantity * fillPrice;
      chargedFee = sellNotional * this.feeRate;
      const pnl = (fillPrice - this.position.averagePrice) * sellQuantity - chargedFee;
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
      price: fillPrice,
      fee: chargedFee,
      filledAt: now.toISOString(),
      requestedQuantity: quantity,
      quotedPrice: price
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
    const publicPolicy: PaperRiskPolicy = {
      quantityStep: this.riskPolicy.quantityStep,
      dustThreshold: this.riskPolicy.dustThreshold
    };
    if (this.riskPolicy.maxOrderNotional !== null) publicPolicy.maxOrderNotional = this.riskPolicy.maxOrderNotional;
    if (this.riskPolicy.maxPositionQuantity !== null) publicPolicy.maxPositionQuantity = this.riskPolicy.maxPositionQuantity;
    if (this.riskPolicy.maxRealizedLoss !== null) publicPolicy.maxRealizedLoss = this.riskPolicy.maxRealizedLoss;
    if (this.riskPolicy.priceTick !== null) publicPolicy.priceTick = this.riskPolicy.priceTick;
    if (this.riskPolicy.minOrderNotional !== null) publicPolicy.minOrderNotional = this.riskPolicy.minOrderNotional;

    const validated = new PaperBroker(1, this.position.market, this.feeRate, publicPolicy, state).exportState();
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
