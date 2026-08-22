import type { UpbitLiveReadOnlySnapshot } from "./upbitRestAdapter";

export type ReadOnlyReconciliationStatus = "MATCH" | "DIFF" | "UNKNOWN";

export interface UpbitReadOnlyReconciliationResult {
  readonly status: ReadOnlyReconciliationStatus;
  readonly observedAt: string;
  readonly reason: string;
  readonly changedCurrencies: readonly string[];
  readonly openOrderDifferenceCount: number | null;
}

function accountMap(snapshot: UpbitLiveReadOnlySnapshot): Map<string, { balance: string; locked: string }> {
  return new Map(snapshot.accounts.map((account) => [account.currency, { balance: account.balance, locked: account.locked }]));
}

export function reconcileReadOnlySnapshots(previous: UpbitLiveReadOnlySnapshot | null, current: UpbitLiveReadOnlySnapshot): UpbitReadOnlyReconciliationResult {
  if (!previous) {
    return Object.freeze({
      status: "UNKNOWN",
      observedAt: current.observedAt,
      reason: "No prior read-only broker baseline is available",
      changedCurrencies: Object.freeze([]),
      openOrderDifferenceCount: null,
    });
  }

  const before = accountMap(previous);
  const after = accountMap(current);
  const currencies = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changedCurrencies = currencies.filter((currency) => JSON.stringify(before.get(currency) ?? null) !== JSON.stringify(after.get(currency) ?? null));
  const openOrderDifferenceCount = current.openOrders.length - previous.openOrders.length;
  const match = changedCurrencies.length === 0 && openOrderDifferenceCount === 0;
  return Object.freeze({
    status: match ? "MATCH" : "DIFF",
    observedAt: current.observedAt,
    reason: match ? "Consecutive read-only broker snapshots match" : "Read-only broker account or open-order snapshot changed",
    changedCurrencies: Object.freeze(changedCurrencies),
    openOrderDifferenceCount,
  });
}
