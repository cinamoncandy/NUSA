import { useEffect, useState } from "react";
import type { PortfolioAccountResponse } from "./portfolioViewModel";
import {
  readObservedTradingSnapshot,
  subscribeObservedTradingSnapshot,
  type Order,
  type TradingSnapshot,
} from "./tradingService";
import {
  getLocalPaperObservedMarket,
  subscribeLocalPaperObservedMarket,
} from "./localPaperLearningProjection";

const LOCAL_PAPER_MARKET = "KRW-BTC";

type RealizedState = Readonly<{ quantity: number; averagePrice: number; realizedPnL: number }>;

function replayRealizedPnL(orders: readonly Order[]): RealizedState {
  let quantity = 0;
  let averagePrice = 0;
  let realizedPnL = 0;
  const filled = [...orders]
    .filter((order) => order.status === "FILLED" && order.market === LOCAL_PAPER_MARKET)
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
  for (const order of filled) {
    if (order.side === "BUY") {
      const nextQuantity = quantity + order.quantity;
      averagePrice = nextQuantity > 0 ? ((quantity * averagePrice) + (order.quantity * order.price)) / nextQuantity : 0;
      quantity = nextQuantity;
      continue;
    }
    const soldQuantity = Math.min(quantity, order.quantity);
    realizedPnL += (order.price - averagePrice) * soldQuantity;
    quantity = Math.max(0, quantity - soldQuantity);
    if (quantity === 0) averagePrice = 0;
  }
  return Object.freeze({ quantity, averagePrice, realizedPnL });
}

function observedAtFor(trading: TradingSnapshot): string {
  const market = getLocalPaperObservedMarket();
  if (market) return market.observedAt;
  const latestOrder = [...trading.orders].sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
  return latestOrder ? new Date(latestOrder.createdAtMs).toISOString() : new Date(0).toISOString();
}

export function buildLocalPaperPortfolio(trading: TradingSnapshot, markPrice: number | null): PortfolioAccountResponse {
  const cash = trading.balances.find((balance) => balance.currency === "KRW")?.available ?? 0;
  const position = trading.positions.find((candidate) => candidate.market === LOCAL_PAPER_MARKET);
  const quantity = position?.quantity ?? 0;
  const averagePrice = position?.averageEntryPrice ?? 0;
  const validMarkPrice = markPrice != null && Number.isFinite(markPrice) && markPrice > 0 ? markPrice : 0;
  const assetValue = quantity * validMarkPrice;
  const realized = replayRealizedPnL(trading.orders).realizedPnL;
  const unrealizedPnl = quantity > 0 && validMarkPrice > 0 ? (validMarkPrice - averagePrice) * quantity : 0;
  return Object.freeze({
    observedAt: observedAtFor(trading),
    mode: "PAPER" as const,
    account: Object.freeze({
      available: true,
      cash,
      equity: cash + assetValue,
      unrealizedPnl,
      assetValue,
      realizedPnl: realized,
      markPrice: validMarkPrice,
      position: Object.freeze({
        market: LOCAL_PAPER_MARKET,
        quantity,
        averagePrice,
        realizedPnl: realized,
        unrealizedPnl,
      }),
      orders: trading.orders,
    }),
    openOrderCount: 0,
  });
}

export function readLocalPaperPortfolio(): PortfolioAccountResponse | null {
  const trading = readObservedTradingSnapshot();
  if (!trading) return null;
  const markPrice = getLocalPaperObservedMarket()?.price ?? null;
  return buildLocalPaperPortfolio(trading, markPrice);
}

export function useLocalPaperPortfolio(): PortfolioAccountResponse | null {
  const [portfolio, setPortfolio] = useState<PortfolioAccountResponse | null>(() => readLocalPaperPortfolio());
  useEffect(() => {
    const refresh = () => setPortfolio(readLocalPaperPortfolio());
    const unsubscribeTrading = subscribeObservedTradingSnapshot(refresh);
    const unsubscribeMarket = subscribeLocalPaperObservedMarket(refresh);
    refresh();
    return () => {
      unsubscribeTrading();
      unsubscribeMarket();
    };
  }, []);
  return portfolio;
}
