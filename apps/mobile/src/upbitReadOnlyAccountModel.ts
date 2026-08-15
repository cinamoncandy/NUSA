import type { UpbitLiveSnapshot } from "./upbitLiveClient";

export interface UpbitReadOnlyAsset {
  readonly currency: string;
  readonly available: number;
  readonly locked: number;
  readonly avgBuyPrice: number;
  readonly unitCurrency: string;
}

export interface UpbitReadOnlyAccountSnapshot {
  readonly provider: "UPBIT";
  readonly mode: "READ_ONLY";
  readonly fetchedAt: number;
  readonly cash: Readonly<{ currency: "KRW"; available: number; locked: number }>;
  readonly assets: readonly UpbitReadOnlyAsset[];
}

export function normalizeUpbitReadOnlySnapshot(source: UpbitLiveSnapshot): UpbitReadOnlyAccountSnapshot {
  const cashRows = source.accounts.filter((item) => item.currency === "KRW");
  const cash = cashRows.reduce((total, item) => ({ available: total.available + item.balance, locked: total.locked + item.locked }), { available: 0, locked: 0 });
  const assets = source.accounts.filter((item) => item.currency !== "KRW").map((item) => Object.freeze({
    currency: item.currency,
    available: item.balance,
    locked: item.locked,
    avgBuyPrice: item.avgBuyPrice,
    unitCurrency: item.unitCurrency,
  }));
  return Object.freeze({ provider: "UPBIT", mode: "READ_ONLY", fetchedAt: source.fetchedAt, cash: Object.freeze({ currency: "KRW", available: cash.available, locked: cash.locked }), assets: Object.freeze(assets) });
}

