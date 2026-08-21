export type PaperSide = "BUY" | "SELL";

export interface PaperOrder {
  id: string;
  /** Present only when the order was created from an attributed strategy signal. */
  strategyId?: string;
  market: string;
  side: PaperSide;
  quantity: number;
  price: number;
  fee: number;
  filledAt: string;
  requestedQuantity: number;
  quotedPrice: number;
  spreadCost: number;
  slippageCost: number;
  marketImpactCost: number;
}

export interface PaperLedgerEntry {
  readonly sequence: number;
  readonly orderId: string;
  readonly fillId: string;
  readonly market: string;
  readonly side: PaperSide;
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly cashBefore: number;
  readonly cashAfter: number;
  readonly positionQuantityBefore: number;
  readonly positionQuantityAfter: number;
  readonly realizedPnlAfter: number;
  readonly occurredAt: string;
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
  /** Cost of crossing the bid-ask spread, in basis points of the quoted price. Half the spread is charged, matching apps/desktop/src/strategy/backtestEngine.ts's execution-cost convention. */
  spreadBps?: number;
  /** Fraction (0, 1] of the requested quantity that can fill against one quote. The remainder is rejected, never queued or retried. */
  maxFillRatio?: number;
  /** Additional adverse price movement, in basis points per unit of quantity filled, modeling that larger orders move the price further. Unset or 0 disables order-size-dependent impact. */
  marketImpactBpsPerUnit?: number;
}

interface NormalizedPaperFillModel {
  readonly slippageBps: number;
  readonly spreadBps: number;
  readonly maxFillRatio: number;
  readonly marketImpactBpsPerUnit: number;
}

export interface PaperBrokerState {
  version: 1;
  cash: number;
  feeRate: number;
  position: PaperPosition;
  orders: readonly PaperOrder[];
  ledger?: readonly PaperLedgerEntry[];
}

export interface PaperAccountSnapshot {
  cash: number;
  equity: number;
  unrealizedPnl: number;
  markPrice: number;
  position: PaperPosition;
  orders: readonly PaperOrder[];
}

const LEDGER_REPLAY_SCALE = 100_000_000n;

function toScaledLedgerAmount(amount: number): bigint {
  if (!Number.isFinite(amount)) throw new Error("ledger amount must be finite");
  return BigInt(Math.round(amount * Number(LEDGER_REPLAY_SCALE)));
}

function fromScaledLedgerAmount(amount: bigint): number {
  return Number(amount) / Number(LEDGER_REPLAY_SCALE);
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
  private readonly ledger: PaperLedgerEntry[];
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
    const spreadBps = fillModel.spreadBps ?? 0;
    const maxFillRatio = fillModel.maxFillRatio ?? 1;
    const marketImpactBpsPerUnit = fillModel.marketImpactBpsPerUnit ?? 0;
    assertFiniteNonNegative(slippageBps, "slippageBps");
    assertFiniteNonNegative(spreadBps, "spreadBps");
    assertFiniteNonNegative(marketImpactBpsPerUnit, "marketImpactBpsPerUnit");
    if (!Number.isFinite(maxFillRatio) || maxFillRatio <= 0 || maxFillRatio > 1) {
      throw new Error("maxFillRatio must be in (0, 1]");
    }
    this.fillModel = Object.freeze({ slippageBps, spreadBps, maxFillRatio, marketImpactBpsPerUnit });

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
      this.ledger = (restoredState.ledger ?? []).map((entry) => ({ ...entry }));
      if (this.ledger.length > 0) this.projectFromLedger(this.ledger[0].cashBefore);
    } else {
      this.cash = initialCash;
      this.feeRate = feeRate;
      this.position = { market, quantity: 0, averagePrice: 0, realizedPnl: 0 };
      this.orders = [];
      this.ledger = [];
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

  private projectFromLedger(initialCash: number): void {
    let cash = toScaledLedgerAmount(initialCash);
    let quantity = 0n;
    let costBasis = 0n;
    let realizedPnl = 0n;
    for (const entry of this.ledger) {
      const entryQuantity = toScaledLedgerAmount(entry.quantity);
      const entryPrice = toScaledLedgerAmount(entry.price);
      const entryFee = toScaledLedgerAmount(entry.fee);
      if (entry.side === "BUY") {
        cash -= (entryQuantity * entryPrice) / LEDGER_REPLAY_SCALE + entryFee;
        costBasis += (entryQuantity * entryPrice) / LEDGER_REPLAY_SCALE;
        quantity += entryQuantity;
      } else {
        const averagePrice = quantity === 0n ? 0n : (costBasis * LEDGER_REPLAY_SCALE) / quantity;
        cash += (entryQuantity * entryPrice) / LEDGER_REPLAY_SCALE - entryFee;
        realizedPnl += ((entryPrice - averagePrice) * entryQuantity) / LEDGER_REPLAY_SCALE - entryFee;
        costBasis -= (averagePrice * entryQuantity) / LEDGER_REPLAY_SCALE;
        quantity -= entryQuantity;
        if (quantity === 0n) costBasis = 0n;
      }
    }
    this.cash = fromScaledLedgerAmount(cash);
    this.position.quantity = this.normalizePositionQuantity(fromScaledLedgerAmount(quantity));
    this.position.averagePrice = this.position.quantity === 0 ? 0 : fromScaledLedgerAmount((costBasis * LEDGER_REPLAY_SCALE) / quantity);
    this.position.realizedPnl = fromScaledLedgerAmount(realizedPnl);
  }

  execute(side: PaperSide, quantity: number, price: number, now = new Date(), attribution: Readonly<{ strategyId?: string }> = {}): PaperOrder {
    if (side !== "BUY" && side !== "SELL") throw new Error("invalid paper side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be positive");
    if (!Number.isFinite(price) || price <= 0) throw new Error("price must be positive");
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("now must be a valid date");
    const cashBefore = this.cash;
    const positionQuantityBefore = this.position.quantity;
    if (this.riskPolicy.priceTick !== null && !isAlignedToTick(price, this.riskPolicy.priceTick)) {
      throw new Error("price does not align to tick size");
    }

    const liquidityLimitedQuantity = quantity * this.fillModel.maxFillRatio;
    const normalizedQuantity = this.normalizeOrderQuantity(liquidityLimitedQuantity);
    const impactBps = normalizedQuantity * this.fillModel.marketImpactBpsPerUnit;
    const adverseBps = this.fillModel.slippageBps + this.fillModel.spreadBps / 2 + impactBps;
    const fillPrice = side === "BUY"
      ? price * (1 + adverseBps / 10_000)
      : price * (1 - adverseBps / 10_000);
    const notional = normalizedQuantity * fillPrice;
    let chargedFee = notional * this.feeRate;
    let spreadCost = price * normalizedQuantity * this.fillModel.spreadBps / 20_000;
    let slippageCost = price * normalizedQuantity * this.fillModel.slippageBps / 10_000;
    let marketImpactCost = price * normalizedQuantity * impactBps / 10_000;

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

    let nextCash = this.cash;
    let nextQuantity = this.position.quantity;
    let nextRealizedPnl = this.position.realizedPnl;
    if (side === "BUY") {
      nextQuantity = this.normalizePositionQuantity(this.position.quantity + normalizedQuantity);
      if (this.riskPolicy.maxPositionQuantity !== null && nextQuantity > this.riskPolicy.maxPositionQuantity) {
        throw new Error("paper risk: max position quantity exceeded");
      }
      if (notional + chargedFee > this.cash) throw new Error("insufficient paper cash");
      nextCash -= notional + chargedFee;
    } else {
      const sellQuantity = Math.min(normalizedQuantity, this.position.quantity);
      const sellNotional = sellQuantity * fillPrice;
      chargedFee = sellNotional * this.feeRate;
      spreadCost = price * sellQuantity * this.fillModel.spreadBps / 20_000;
      slippageCost = price * sellQuantity * this.fillModel.slippageBps / 10_000;
      marketImpactCost = price * sellQuantity * impactBps / 10_000;
      const pnl = (fillPrice - this.position.averagePrice) * sellQuantity - chargedFee;
      nextCash += sellNotional - chargedFee;
      nextQuantity = this.normalizePositionQuantity(this.position.quantity - sellQuantity);
      nextRealizedPnl += pnl;
    }

    const order: PaperOrder = Object.freeze({
      id: `${now.getTime()}-${this.orders.length + 1}`,
      ...(attribution.strategyId === undefined ? {} : { strategyId: attribution.strategyId }),
      market: this.position.market,
      side,
      quantity: normalizedQuantity,
      price: fillPrice,
      fee: chargedFee,
      filledAt: now.toISOString(),
      requestedQuantity: quantity,
      quotedPrice: price,
      spreadCost,
      slippageCost,
      marketImpactCost
    });
    this.orders.unshift(order);
    this.ledger.push(Object.freeze({ sequence: this.ledger.length + 1, orderId: order.id, fillId: `fill:${order.id}`, market: order.market, side: order.side, quantity: order.quantity, price: order.price, fee: order.fee, cashBefore, cashAfter: nextCash, positionQuantityBefore, positionQuantityAfter: nextQuantity, realizedPnlAfter: nextRealizedPnl, occurredAt: order.filledAt }));
    this.projectFromLedger(this.ledger[0].cashBefore);
    return order;
  }

  exportState(): PaperBrokerState {
    return Object.freeze({
      version: 1 as const,
      cash: this.cash,
      feeRate: this.feeRate,
      position: Object.freeze({ ...this.position }),
      orders: Object.freeze(this.orders.map((order) => Object.freeze({ ...order }))),
      ledger: Object.freeze(this.ledger.map((entry) => Object.freeze({ ...entry })))
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
    this.ledger.splice(0, this.ledger.length, ...(validated.ledger ?? []).map((entry) => ({ ...entry })));
  }

  snapshot(markPrice: number): PaperAccountSnapshot {
    if (!Number.isFinite(markPrice) || markPrice <= 0) throw new Error("markPrice must be positive");
    const marketValue = this.position.quantity * markPrice;
    const unrealizedPnl = this.position.quantity * (markPrice - this.position.averagePrice);
    return Object.freeze({
      cash: this.cash,
      equity: this.cash + marketValue,
      unrealizedPnl,
      markPrice,
      position: Object.freeze({ ...this.position }),
      orders: Object.freeze([...this.orders])
    });
  }
}
