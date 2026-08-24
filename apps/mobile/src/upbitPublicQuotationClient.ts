import { parsePublicCandles, type PublicCandle } from "./chartViewModel";
import type { WatchlistMarket } from "./watchlist";
import { readNativeRequestDiagnostic } from "./androidNetworkDiagnostics";

export const UPBIT_PUBLIC_QUOTATION_BASE_URL = "https://api.upbit.com";
export const UPBIT_PUBLIC_TICKER_PATH = "/v1/ticker/all?quote_currencies=KRW";
export const UPBIT_PUBLIC_CANDLE_PATH = "/v1/candles/minutes/1";
export const DEFAULT_PUBLIC_CANDLE_COUNT = 120;
export const MAX_PUBLIC_CANDLE_COUNT = 200;

export interface UpbitPublicQuotationClientOptions {
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export interface UpbitPublicCandleOptions extends UpbitPublicQuotationClientOptions {
  readonly market: string;
  readonly count?: number;
}

const marketPattern = /^KRW-[A-Z0-9]+$/;

function finiteNumber(value: unknown, field: string, allowNegative = false): number {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || (!allowNegative && number < 0)) throw new Error(`Invalid Upbit ${field}.`);
  return number;
}

function positiveFiniteNumber(value: unknown, field: string): number {
  const number = finiteNumber(value, field);
  if (number <= 0) throw new Error(`Invalid Upbit ${field}.`);
  return number;
}

function normalizedMarket(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid Upbit market.");
  const market = value.trim().toUpperCase();
  if (!marketPattern.test(market)) throw new Error("Invalid Upbit market.");
  return market;
}

function normalizedTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(value)) {
    throw new Error("Invalid Upbit timestamp.");
  }
  const observedAt = new Date(value);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("Invalid Upbit timestamp.");
  return observedAt.toISOString();
}

function boundedCount(value: number | undefined): number {
  const count = value ?? DEFAULT_PUBLIC_CANDLE_COUNT;
  if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_PUBLIC_CANDLE_COUNT) throw new Error("Upbit candle count is out of bounds.");
  return count;
}

function normalizedBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? UPBIT_PUBLIC_QUOTATION_BASE_URL).trim().replace(/\/+$/, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Upbit public quotation base URL must be HTTPS without credentials or query state.");
  return baseUrl;
}

function timeoutMs(value: number | undefined): number {
  const timeout = value ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 30_000) throw new Error("Upbit public quotation timeout is out of bounds.");
  return timeout;
}

function compactErrorText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.slice(0, 160);
}

/**
 * Everything a real-device failure needs to confirm root cause without guessing again: the exact
 * URL/method this file actually asked fetch() for, what Upbit actually returned, and what the
 * native OkHttp layer actually put on the wire. Deliberately not a header dump -- every field is
 * named individually so there is no path from "add a diagnostic" to "accidentally log a
 * credential header" the way a generic `for (header of response.headers)` loop would allow.
 */
export interface PublicQuotationDiagnostic {
  readonly requestUrl: string;
  readonly method: "GET";
  readonly status: number | null;
  readonly responseErrorName?: string;
  readonly responseErrorMessage?: string;
  readonly responseContentType?: string;
  readonly finalUserAgent?: string;
  readonly timestamp: string;
}

export class UpbitPublicQuotationError extends Error {
  public readonly diagnostic: PublicQuotationDiagnostic;

  public constructor(message: string, diagnostic: PublicQuotationDiagnostic) {
    super(message);
    this.name = "UpbitPublicQuotationError";
    this.diagnostic = diagnostic;
  }
}

async function upstreamDiagnostic(requestUrl: string, response: Response): Promise<PublicQuotationDiagnostic> {
  let responseErrorName: string | undefined;
  let responseErrorMessage: string | undefined;
  try {
    const payload = await response.json() as unknown;
    if (payload != null && typeof payload === "object" && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      if (record.error != null && typeof record.error === "object" && !Array.isArray(record.error)) {
        const error = record.error as Record<string, unknown>;
        responseErrorName = compactErrorText(error.name);
        responseErrorMessage = compactErrorText(error.message);
      } else {
        responseErrorMessage = compactErrorText(record.error);
      }
    }
  } catch {
    // Upbit normally returns JSON errors, but status alone is still actionable if it does not.
  }
  // Best-effort: the native module may not exist (non-Android, or a build without it), and this
  // must never block or fail the diagnostic just because that lookup did not resolve.
  const nativeDiagnostic = await readNativeRequestDiagnostic().catch(() => null);
  return Object.freeze({
    requestUrl,
    method: "GET" as const,
    status: response.status,
    responseErrorName,
    responseErrorMessage,
    responseContentType: response.headers.get("content-type") ?? undefined,
    finalUserAgent: nativeDiagnostic?.userAgent ?? undefined,
    timestamp: new Date().toISOString(),
  });
}

async function requestJson(path: string, options: UpbitPublicQuotationClientOptions): Promise<unknown> {
  const request = options.request ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(options.timeoutMs));
  const requestUrl = `${normalizedBaseUrl(options.baseUrl)}${path}`;
  try {
    const response = await request(requestUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      // Do not add JS-layer headers here. React Native's Android networking bridge does not
      // guarantee a fetch() header replaces OkHttp's own default rather than being sent
      // alongside it, so this file cannot reliably control any header from JS in either
      // direction (adding a custom User-Agent got a 400 for OkHttp's generic default; a
      // plain fetch header can also risk a 400 for a duplicate). The public GET endpoint
      // needs no credential/Content-Type/Accept override, and the User-Agent's single
      // source of truth is the native OkHttp interceptor in MainApplication.kt, which runs
      // after RN's bridge builds the request and replaces the header outright -- see
      // NusaUserAgentInterceptor there for why `.header()` (replace), not `.addHeader()`
      // (append), is what actually fixes this.
    });
    if (!response.ok) {
      const diagnostic = await upstreamDiagnostic(requestUrl, response);
      const detail = [diagnostic.responseErrorName, diagnostic.responseErrorMessage].filter(Boolean).join(": ");
      throw new UpbitPublicQuotationError(`Upbit public quotation unavailable (${response.status}${detail ? `: ${detail}` : ""}).`, diagnostic);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof UpbitPublicQuotationError) throw error;
    if (controller.signal.aborted) throw new Error("Upbit public quotation request timed out.");
    throw new Error("Upbit public quotation request failed.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shared row shape between Upbit's REST ticker response (field `market`) and its DEFAULT-format
 * WebSocket ticker push (field `code`) -- both carry the same trade_price/signed_change_rate/
 * acc_trade_volume_24h/timestamp fields, just under a different market-code key. Exported so
 * upbitPublicWebSocketClient.ts can reuse the exact same validation instead of duplicating it.
 */
export function parseUpbitTickerRow(value: unknown, marketField: "market" | "code", index: number | string = 0): WatchlistMarket {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Upbit ticker ${index} is invalid.`);
  const row = value as Record<string, unknown>;
  const market = normalizedMarket(row[marketField]);
  const price = positiveFiniteNumber(row.trade_price, "trade price");
  const changeRate = finiteNumber(row.signed_change_rate, "signed change rate", true);
  const volume = finiteNumber(row.acc_trade_volume_24h, "24h trade volume");
  const observedAt = normalizedTimestamp(row.timestamp);
  return Object.freeze({ market, price, changeRate, volume, observedAt, source: "UPBIT_PUBLIC_TICKER" as const });
}

export function normalizeUpbitTickerPayload(raw: unknown): readonly WatchlistMarket[] {
  if (!Array.isArray(raw)) throw new Error("Upbit ticker response is invalid.");
  return Object.freeze(raw.map((value, index) => parseUpbitTickerRow(value, "market", index)));
}

export async function loadUpbitPublicMarkets(options: UpbitPublicQuotationClientOptions = {}): Promise<readonly WatchlistMarket[]> {
  return normalizeUpbitTickerPayload(await requestJson(UPBIT_PUBLIC_TICKER_PATH, options));
}

export function normalizeUpbitCandlePayload(raw: unknown, market: string): readonly PublicCandle[] {
  return parsePublicCandles(raw, normalizedMarket(market));
}

export async function loadUpbitPublicCandles(options: UpbitPublicCandleOptions): Promise<readonly PublicCandle[]> {
  const market = normalizedMarket(options.market);
  const url = new URL(`${normalizedBaseUrl(options.baseUrl)}${UPBIT_PUBLIC_CANDLE_PATH}`);
  url.searchParams.set("market", market);
  url.searchParams.set("count", String(boundedCount(options.count)));
  return normalizeUpbitCandlePayload(await requestJson(`${url.pathname}${url.search}`, options), market);
}
