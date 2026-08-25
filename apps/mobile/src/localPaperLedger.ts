import { MockTradingService, type PlaceOrderRequest, type Order, type TradingSnapshot } from "./tradingService";
import type { PortfolioAccountResponse } from "./portfolioViewModel";
import { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";

/**
 * Issue #637: LOCAL PAPER previously lived entirely inside the Trade screen's own component state,
 * so a fill made there was invisible to Home and Portfolio, and disappeared on tab remount. This is
 * the one app-level LOCAL PAPER ledger: Home, Trade, and Portfolio all read (and Trade writes)
 * through this single module-level instance instead of each screen owning disconnected state.
 *
 * This never talks to Cloud and never gains LIVE/production-mutation authority: it is the same
 * PAPER-only MockTradingService the Trade screen already used, just promoted out of one screen.
 *
 * Deliberately free of any "react"/"react-native" import so this ledger's core logic can be
 * exercised directly in a plain Node test. React-only bindings live in ./localPaperLedgerHooks.
 */
export const LOCAL_PAPER_MARKET = "KRW-BTC";
export const LOCAL_PAPER_INITIAL_CASH = 10_000_000;

const initialLocalTradingSnapshot = (): TradingSnapshot => Object.freeze({
  orders: Object.freeze([]),
  positions: Object.freeze([]),
  balances: Object.freeze([{ currency: "KRW", available: LOCAL_PAPER_INITIAL_CASH }])
});

export const localPaperLedgerService = new MockTradingService([{ currency: "KRW", available: LOCAL_PAPER_INITIAL_CASH }]);

let cachedSnapshot: TradingSnapshot = initialLocalTradingSnapshot();
const listeners = new Set<() => void>();

function notify(): void { for (const listener of listeners) listener(); }

/** Synchronous, always-current read of the last known ledger state. Never resets on remount. */
export function getCachedLocalPaperSnapshot(): TradingSnapshot { return cachedSnapshot; }

export function subscribeLocalPaperLedger(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function refreshCachedLocalPaperSnapshot(): Promise<TradingSnapshot> {
  cachedSnapshot = await localPaperLedgerService.getSnapshot();
  notify();
  return cachedSnapshot;
}

/** Places an order against the one shared ledger and immediately notifies every subscriber. */
export async function placeLocalPaperOrder(request: PlaceOrderRequest): Promise<Order> {
  const order = await localPaperLedgerService.placePaperOrder(request);
  await refreshCachedLocalPaperSnapshot();
  return order;
}

/** Forces a resync from the ledger (e.g. on first mount) without placing an order. */
export function reloadLocalPaperSnapshot(): Promise<TradingSnapshot> {
  return refreshCachedLocalPaperSnapshot();
}

/**
 * Same activation rule the Trade screen already used: LOCAL PAPER is active exactly when Cloud
 * PAPER is not configured/verified for this build. Every screen must derive this from the same
 * expression so they never disagree about which ledger is authoritative.
 */
export function isLocalPaperActive(): boolean {
  const session = new InMemoryDashboardCredentialSession();
  const configuredEndpoint = getConfiguredPaperEndpoint();
  const builtInSubmitAvailable = Boolean(configuredEndpoint && session.isConfigured() && isPaperConnectionVerified(configuredEndpoint));
  return !builtInSubmitAvailable;
}

export function buildLocalPortfolio(trading: TradingSnapshot, markPrice: number | null): PortfolioAccountResponse {
  const cash = trading.balances.find((balance) => balance.currency === "KRW")?.available ?? 0;
  const position = trading.positions.find((candidate) => candidate.market === LOCAL_PAPER_MARKET);
  const quantity = position?.quantity ?? 0;
  const averagePrice = position?.averageEntryPrice ?? 0;
  const validMarkPrice = markPrice != null && Number.isFinite(markPrice) && markPrice > 0 ? markPrice : 0;
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
      position: Object.freeze({ market: LOCAL_PAPER_MARKET, quantity, averagePrice, realizedPnl: 0, unrealizedPnl }),
      orders: trading.orders
    }),
    openOrderCount: 0
  });
}
