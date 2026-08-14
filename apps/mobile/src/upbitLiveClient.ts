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

const normalizeBaseUrl = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (url.protocol !== "https:") throw new Error("Upbit bridge must use HTTPS.");
  if (url.username || url.password) throw new Error("Upbit bridge URL must not contain credentials.");
  return normalized;
};

const finite = (value: unknown, field: string): number => {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid Upbit ${field}.`);
  return parsed;
};

const account = (value: unknown): UpbitAccount => {
  if (typeof value !== "object" || value === null) throw new Error("Invalid Upbit account payload.");
  const row = value as Record<string, unknown>;
  if (typeof row.currency !== "string" || !row.currency.trim()) throw new Error("Invalid Upbit currency.");
  if (typeof row.unit_currency !== "string" || !row.unit_currency.trim()) throw new Error("Invalid Upbit unit currency.");
  return Object.freeze({
    currency: row.currency.trim().toUpperCase(),
    balance: finite(row.balance, "balance"),
    locked: finite(row.locked, "locked"),
    avgBuyPrice: finite(row.avg_buy_price, "average buy price"),
    unitCurrency: row.unit_currency.trim().toUpperCase(),
  });
};

export async function loadUpbitLiveAccounts(options: Readonly<{
  credentialProvider: UpbitCredentialProvider;
  baseUrl?: string;
}>): Promise<UpbitLiveSnapshot> {
  const token = (await options.credentialProvider())?.trim() ?? "";
  if (!token) throw new Error("Upbit bridge credential is required.");
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const response = await fetch(`${baseUrl}/api/upbit/accounts`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).error === "string"
      ? String((payload as Record<string, unknown>).error)
      : `HTTP_${response.status}`;
    throw new Error(message);
  }
  if (!Array.isArray(payload)) throw new Error("Invalid Upbit accounts response.");
  const accounts = Object.freeze(payload.map(account));
  const krwBalance = accounts.find((item) => item.currency === "KRW")?.balance ?? 0;
  return Object.freeze({ accounts, krwBalance, fetchedAt: Date.now() });
}

export const UPBIT_LIVE_BASE_URL = DEFAULT_BASE_URL;
