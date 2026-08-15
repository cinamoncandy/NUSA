import type { UpbitCredentialProvider } from "./upbitCredentialSession";

export interface UpbitAccount {
  readonly currency: string;
  readonly balance: number;
  readonly locked: number;
  readonly avgBuyPrice: number;
  readonly unitCurrency: string;
}

export interface UpbitLiveSnapshot {
  readonly accounts: readonly UpbitAccount[];
  readonly krwBalance: number;
  readonly fetchedAt: number;
}

const DEFAULT_BASE_URL = "https://nusa-api.duckdns.org";
const ACCOUNT_SUMMARY_PATH = "/api/v1/account/summary";

const normalizeBaseUrl = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (url.protocol !== "https:") throw new Error("Upbit bridge must use HTTPS.");
  if (url.username || url.password) throw new Error("Upbit bridge URL must not contain credentials.");
  return normalized;
};

const finite = (value: unknown, field: string): number => {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Invalid Upbit " + field + ".");
  return parsed;
};

const currency = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^[A-Z0-9]{2,12}$/.test(value.trim().toUpperCase())) {
    throw new Error("Invalid Upbit " + field + ".");
  }
  return value.trim().toUpperCase();
};

const normalizedSummary = (value: unknown): UpbitLiveSnapshot => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Upbit account summary.");
  }
  const summary = value as Record<string, unknown>;
  if (summary.provider !== "UPBIT" || summary.mode !== "READ_ONLY") {
    throw new Error("Invalid Upbit account summary.");
  }
  if (typeof summary.fetchedAt !== "string" || !Number.isFinite(Date.parse(summary.fetchedAt))) {
    throw new Error("Invalid Upbit fetched timestamp.");
  }
  if (typeof summary.cash !== "object" || summary.cash === null || Array.isArray(summary.cash)) {
    throw new Error("Invalid Upbit cash summary.");
  }
  const cash = summary.cash as Record<string, unknown>;
  if (currency(cash.currency, "cash currency") !== "KRW") throw new Error("Invalid Upbit cash currency.");
  const cashAccount: UpbitAccount = Object.freeze({
    currency: "KRW",
    balance: finite(cash.available, "cash available"),
    locked: finite(cash.locked, "cash locked"),
    avgBuyPrice: 0,
    unitCurrency: "KRW",
  });
  if (!Array.isArray(summary.assets)) throw new Error("Invalid Upbit assets.");
  const assets = summary.assets.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Invalid Upbit asset.");
    }
    const asset = value as Record<string, unknown>;
    return Object.freeze({
      currency: currency(asset.currency, "asset currency"),
      balance: finite(asset.available, "asset available"),
      locked: finite(asset.locked, "asset locked"),
      avgBuyPrice: finite(asset.avgBuyPrice, "asset average buy price"),
      unitCurrency: currency(asset.unitCurrency, "asset unit currency"),
    });
  });
  const accounts = Object.freeze([cashAccount, ...assets]);
  return Object.freeze({
    accounts,
    krwBalance: cashAccount.balance,
    fetchedAt: Date.parse(summary.fetchedAt),
  });
};

export async function loadUpbitLiveAccounts(options: Readonly<{
  credentialProvider: UpbitCredentialProvider;
  baseUrl?: string;
}>): Promise<UpbitLiveSnapshot> {
  const token = (await options.credentialProvider())?.trim() ?? "";
  if (!token) throw new Error("Upbit bridge credential is required.");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const response = await fetch(baseUrl + ACCOUNT_SUMMARY_PATH, {
    method: "GET",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).error === "string"
      ? String((payload as Record<string, unknown>).error)
      : "HTTP_" + response.status;
    throw new Error(message);
  }
  return normalizedSummary(payload);
}


export type UpbitReadOnlyOrderState = "OPEN" | "PARTIAL" | "DONE" | "CANCELLED" | "REJECTED";
export interface UpbitReadOnlyOrder {
  readonly uuid: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly ordType: "LIMIT" | "MARKET" | "BEST";
  readonly price: number | null;
  readonly volume: number;
  readonly executedVolume: number;
  readonly remainingVolume: number;
  readonly state: UpbitReadOnlyOrderState;
  readonly createdAt: string;
}

const ORDER_OPEN_PATH = "/api/v1/orders/open";
const ORDER_HISTORY_PATH = "/api/v1/orders/history";
const ORDER_DETAIL_PREFIX = "/api/v1/orders/";

const normalizedOrder = (value: unknown): UpbitReadOnlyOrder => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Upbit order.");
  const order = value as Record<string, unknown>;
  if (typeof order.uuid !== "string" || !/^[0-9a-f-]{20,64}$/i.test(order.uuid)) throw new Error("Invalid Upbit order uuid.");
  if (typeof order.market !== "string" || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(order.market)) throw new Error("Invalid Upbit order market.");
  if (order.side !== "BUY" && order.side !== "SELL") throw new Error("Invalid Upbit order side.");
  if (order.ordType !== "LIMIT" && order.ordType !== "MARKET" && order.ordType !== "BEST") throw new Error("Invalid Upbit order type.");
  const price = order.price === null ? null : finite(order.price, "order price");
  const volume = finite(order.volume, "order volume");
  const executedVolume = finite(order.executedVolume, "executed volume");
  const remainingVolume = finite(order.remainingVolume, "remaining volume");
  if (executedVolume > volume || remainingVolume > volume || executedVolume + remainingVolume > volume) {
    throw new Error("Invalid Upbit order volume reconciliation.");
  }
  if (order.state !== "OPEN" && order.state !== "PARTIAL" && order.state !== "DONE" && order.state !== "CANCELLED" && order.state !== "REJECTED") {
    throw new Error("Invalid Upbit order state.");
  }
  if (typeof order.createdAt !== "string" || !Number.isFinite(Date.parse(order.createdAt))) throw new Error("Invalid Upbit order timestamp.");
  return Object.freeze({
    uuid: order.uuid,
    market: order.market,
    side: order.side,
    ordType: order.ordType,
    price,
    volume,
    executedVolume,
    remainingVolume,
    state: order.state,
    createdAt: new Date(order.createdAt).toISOString(),
  });
};

export async function loadUpbitLiveOrders(options: Readonly<{
  credentialProvider: UpbitCredentialProvider;
  scope: "open" | "history" | "detail";
  uuid?: string;
  baseUrl?: string;
}>): Promise<readonly UpbitReadOnlyOrder[]> {
  const token = (await options.credentialProvider())?.trim() ?? "";
  if (!token) throw new Error("Upbit bridge credential is required.");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const path = options.scope === "open"
    ? ORDER_OPEN_PATH
    : options.scope === "history"
      ? ORDER_HISTORY_PATH
      : ORDER_DETAIL_PREFIX + (options.uuid ?? "");
  if (options.scope === "detail" && !/^[0-9a-f-]{20,64}$/i.test(options.uuid ?? "")) {
    throw new Error("Invalid Upbit order uuid.");
  }
  const response = await fetch(baseUrl + path, {
    method: "GET",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).error === "string"
      ? String((payload as Record<string, unknown>).error)
      : "HTTP_" + response.status;
    throw new Error(message);
  }
  if (options.scope === "detail") return Object.freeze([normalizedOrder(payload)]);
  if (!Array.isArray(payload)) throw new Error("Invalid Upbit orders response.");
  return Object.freeze(payload.map(normalizedOrder));
}

export const UPBIT_LIVE_BASE_URL = DEFAULT_BASE_URL;
