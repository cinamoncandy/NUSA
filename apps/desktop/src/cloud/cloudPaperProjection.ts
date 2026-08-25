import type { PersonalPaperOperationsSnapshot, PersonalPaperOrderProjection } from "../../../../packages/contracts/src/personalPaperOperations";
import type { PaperAccountSnapshot, PaperOrder } from "../paper/paperBroker";

function toDesktopOrder(order: PersonalPaperOrderProjection): PaperOrder {
  return Object.freeze({
    id: order.id,
    market: order.market,
    side: order.side,
    quantity: order.quantity,
    price: order.price,
    fee: order.fee,
    filledAt: order.filledAt,
    requestedQuantity: order.quantity,
    quotedPrice: order.price,
    // The current canonical Cloud PAPER fill contract exposes fee and fill price, but not a
    // separate spread/slippage/impact attribution. Zero here means "no separate attributed
    // component in this projection", not a promise that market friction is universally zero.
    spreadCost: 0,
    slippageCost: 0,
    marketImpactCost: 0
  });
}

export function projectCloudPaperSnapshot(snapshot: PersonalPaperOperationsSnapshot): PaperAccountSnapshot | null {
  const portfolio = snapshot.portfolio;
  if (portfolio == null) return null;
  const account = portfolio.account;
  return Object.freeze({
    cash: account.cash,
    equity: account.equity,
    unrealizedPnl: account.unrealizedPnl,
    markPrice: account.markPrice,
    position: Object.freeze({
      market: account.position.market,
      quantity: account.position.quantity,
      averagePrice: account.position.averagePrice,
      realizedPnl: account.position.realizedPnl
    }),
    orders: Object.freeze(snapshot.orders.map(toDesktopOrder))
  });
}

export function projectCloudPaperOrder(order: PersonalPaperOrderProjection): PaperOrder {
  return toDesktopOrder(order);
}
