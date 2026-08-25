import { useEffect, useState, useSyncExternalStore } from "react";
import type { TradingSnapshot } from "./tradingService";
import { LOCAL_PAPER_MARKET, getCachedLocalPaperSnapshot, reloadLocalPaperSnapshot, subscribeLocalPaperLedger } from "./localPaperLedger";
import { loadUpbitPublicMarkets } from "./upbitPublicQuotationClient";

/**
 * React bindings for the shared LOCAL PAPER ledger (see ./localPaperLedger for the ledger itself
 * and why it exists -- issue #637). Kept in a separate module so the ledger's own logic can be
 * unit-tested in plain Node without a "react" dependency in the require graph.
 */

/** Live subscription to the shared ledger. Re-renders the caller whenever any screen fills an order. */
export function useLocalPaperSnapshot(): TradingSnapshot {
  const snapshot = useSyncExternalStore(subscribeLocalPaperLedger, getCachedLocalPaperSnapshot, getCachedLocalPaperSnapshot);
  useEffect(() => { void reloadLocalPaperSnapshot(); }, []);
  return snapshot;
}

/**
 * Lightweight public-price poll shared by any screen that needs a mark price for the local ledger.
 * `enabled` lets a caller skip the network poll entirely when LOCAL PAPER is not the active source
 * (e.g. Cloud PAPER is configured), without breaking the rules-of-hooks call order.
 */
export function useLocalPaperMarkPrice(enabled = true, intervalMs = 10_000): number | null {
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) { setMarkPrice(null); return; }
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const markets = await loadUpbitPublicMarkets();
        const selected = markets.find((market) => market.market === LOCAL_PAPER_MARKET);
        if (active) setMarkPrice(selected && Number.isFinite(selected.price) && selected.price > 0 ? selected.price : null);
      } catch {
        if (active) setMarkPrice(null);
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, intervalMs);
    return () => { active = false; clearInterval(timer); };
  }, [enabled, intervalMs]);
  return markPrice;
}
