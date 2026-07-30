import type { UpbitLiveReadOnlySnapshot } from "./upbitLiveReadOnlyAdapter";

export type ReconciliationStatus = "MATCH" | "DIFF" | "UNKNOWN";
export interface UpbitReconciliationResult {
  readonly status: ReconciliationStatus;
  readonly observedAt: string;
  readonly reason: string;
  readonly krwBalance: string | null;
  readonly assetDifferences: readonly string[];
  readonly openOrderDifferenceCount: number | null;
}

const accountMap = (snapshot: UpbitLiveReadOnlySnapshot): Map<string, { balance: string; locked: string }> =>
  new Map(snapshot.accounts.map((account) => [account.currency, { balance: account.balance, locked: account.locked }]));

export function reconcileUpbitSnapshots(previous: UpbitLiveReadOnlySnapshot | null, current: UpbitLiveReadOnlySnapshot): UpbitReconciliationResult {
  if (!previous) return { status: "UNKNOWN", observedAt: current.observedAt, reason: "No account baseline is available", krwBalance: current.accounts.find((x) => x.currency === "KRW")?.balance ?? null, assetDifferences: [], openOrderDifferenceCount: null };
  const before = accountMap(previous);
  const after = accountMap(current);
  const currencies = [...new Set([...before.keys(), ...after.keys()])].sort();
  const differences = currencies.filter((currency) => JSON.stringify(before.get(currency) ?? null) !== JSON.stringify(after.get(currency) ?? null));
  const orderDifferenceCount = current.openOrders.length - previous.openOrders.length;
  return {
    status: differences.length === 0 && orderDifferenceCount === 0 ? "MATCH" : "DIFF",
    observedAt: current.observedAt,
    reason: differences.length === 0 && orderDifferenceCount === 0 ? "Consecutive read-only snapshots match" : "Account or open-order set changed",
    krwBalance: after.get("KRW")?.balance ?? null,
    assetDifferences: differences,
    openOrderDifferenceCount: orderDifferenceCount,
  };
}
