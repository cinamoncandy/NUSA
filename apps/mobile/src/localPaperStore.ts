import type { PortfolioAccountResponse } from "./portfolioViewModel";
import { MockTradingService, type OrderSide, type TradingSnapshot } from "./tradingService";

export const LOCAL_PAPER_MARKET = "KRW-BTC";
export const LOCAL_PAPER_INITIAL_CASH = 10_000_000;

export interface LocalPaperState {
  readonly trading: TradingSnapshot;
  readonly markPrice: number | null;
  readonly portfolio: PortfolioAccountResponse;
}

type Listener = (state: LocalPaperState) => void;

const service = new MockTradingService([{ currency: "KRW", available: LOCAL_PAPER_INITIAL_CASH }]);
const listeners = new Set<Listener>();
let trading: TradingSnapshot = Object.freeze({
  orders: Object.freeze([]),
  positions: Object.freeze([]),
  balances: Object.freeze([{ currency: "KRW", available: LOCAL_PAPER_INITIAL_CASH }]),
});
let markPrice: number | null = null;

function buildPortfolio(snapshot: TradingSnapshot, price: number | null): PortfolioAccountResponse {
  const cash = snapshot.balances.find((balance) => balance.currency === "KRW")?.available ?? 0;
  const position = snapshot.positions.find((candidate) => candidate.market === LOCAL_PAPER_MARKET);
  const quantity = position?.quantity ?? 0;
  const averagePrice = position?.averageEntryPrice ?? 0;
  const validMarkPrice = price != null && Number.isFinite(price) && price > 0 ? price : 0;
  const assetValue = quantity * validMarkPrice;
  const unrealizedPnl = quantity > 0 && validMarkPrice > 0 ? (validMarkPrice - averagePrice) * quantity : 0;
  return Object.freeze({
    observedAt: new Date().toISOString(),
    mode: "PAPER" as const,
    account: Object.freeze({
      available: true,
      cash,
      equity: cash + assetValue,
      unrealizedPnl,
      assetValue,
      realizedPnl: 0,
      markPrice: validMarkPrice,
      position: Object.freeze({
        market: LOCAL_PAPER_MARKET,
        quantity,
        averagePrice,
        realizedPnl: 0,
        unrealizedPnl,
      }),
      orders: snapshot.orders,
    }),
    openOrderCount: 0,
  });
}

function current(): LocalPaperState {
  return Object.freeze({ trading, markPrice, portfolio: buildPortfolio(trading, markPrice) });
}

function publish(): void {
  const state = current();
  for (const listener of listeners) listener(state);
}

export function getLocalPaperState(): LocalPaperState {
  return current();
}

export function subscribeLocalPaper(listener: Listener): () => void {
  listeners.add(listener);
  listener(current());
  return () => { listeners.delete(listener); };
}

export function setLocalPaperMarkPrice(value: number | null): void {
  const next = value != null && Number.isFinite(value) && value > 0 ? value : null;
  if (next === markPrice) return;
  markPrice = next;
  publish();
}

export async function placeLocalPaperOrder(input: Readonly<{ side: OrderSide; quantity: number; price: number; nowMs: number }>) {
  const order = await service.placePaperOrder({
    market: LOCAL_PAPER_MARKET,
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    nowMs: input.nowMs,
  });
  trading = await service.getSnapshot();
  publish();
  return order;
}

export async function restoreLocalPaperState(): Promise<LocalPaperState> {
  trading = await service.getSnapshot();
  const state = current();
  publish();
  return state;
}
