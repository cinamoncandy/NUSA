import type { PaperOrder } from "./paperBroker";

export interface StrategyAnalyticsSnapshot {
  readonly strategyId: string;
  readonly market: string;
  readonly orderCount: number;
  readonly buyCount: number;
  readonly sellCount: number;
  readonly quantity: number;
  readonly averagePrice: number;
  readonly fees: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly netPnl: number;
}

function finitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

/**
 * Independently replays only orders attributed to one strategy. An unattributed or
 * differently attributed order makes the result unavailable rather than silently mixing
 * manual activity into strategy performance.
 */
export function buildStrategyAnalytics(input: Readonly<{
  orders: readonly PaperOrder[];
  strategyId: string;
  market: string;
  markPrice: number;
}>): StrategyAnalyticsSnapshot | null {
  if (!input.strategyId.trim()) throw new Error("strategyId is required");
  finitePositive(input.markPrice, "markPrice");
  const ordered = [...input.orders].sort((left, right) => {
    const time = Date.parse(left.filledAt) - Date.parse(right.filledAt);
    return time !== 0 ? time : left.id.localeCompare(right.id);
  });
  if (ordered.some((order) => order.strategyId !== input.strategyId || order.market !== input.market)) return null;

  let quantity = 0;
  let averagePrice = 0;
  let fees = 0;
  let realizedPnl = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const order of ordered) {
    finitePositive(order.quantity, "order quantity");
    finitePositive(order.price, "order price");
    if (!Number.isFinite(order.fee) || order.fee < 0) throw new Error("order fee must be non-negative");
    if (!Number.isFinite(Date.parse(order.filledAt))) throw new Error("order timestamp is invalid");
    fees += order.fee;
    if (order.side === "BUY") {
      buyCount += 1;
      averagePrice = quantity === 0 ? order.price : ((quantity * averagePrice) + (order.quantity * order.price)) / (quantity + order.quantity);
      quantity += order.quantity;
      realizedPnl -= order.fee;
    } else if (order.side === "SELL") {
      sellCount += 1;
      if (order.quantity > quantity + Number.EPSILON) return null;
      realizedPnl += (order.price - averagePrice) * order.quantity - order.fee;
      quantity -= order.quantity;
      if (quantity <= Number.EPSILON) {
        quantity = 0;
        averagePrice = 0;
      }
    } else {
      throw new Error("order side is invalid");
    }
  }
  const unrealizedPnl = quantity * (input.markPrice - averagePrice);
  return Object.freeze({
    strategyId: input.strategyId,
    market: input.market,
    orderCount: ordered.length,
    buyCount,
    sellCount,
    quantity,
    averagePrice,
    fees,
    realizedPnl,
    unrealizedPnl,
    netPnl: realizedPnl + unrealizedPnl
  });
}
