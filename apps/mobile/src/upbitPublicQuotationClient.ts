import { parsePublicCandles, type PublicCandle } from "./chartViewModel";
import type { WatchlistMarket } from "./watchlist";
import { readNativeRequestDiagnostic } from "./androidNetworkDiagnostics";
import {
  requestNativeAndroidUpbitCandles,
  requestNativeAndroidUpbitTicker,
  type NativeUpbitPublicQuotationResponse,
} from "./androidUpbitPublicQuotation";

export const UPBIT_PUBLIC_QUOTATION_BASE_URL = "https://api.upbit.com";
export const UPBIT_PUBLIC_TICKER_PATH = "/v1/ticker/all?quote_currencies=KRW";
export const UPBIT_PUBLIC_CANDLE_PATH = "/v1/candles/minutes/1";
export const DEFAULT_PUBLIC_CANDLE_COUNT = 120;
export const MAX_PUBLIC_CANDLE_COUNT = 200;

export interface UpbitPublicQuotationClientOptions {
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
  /** Explicit test/development override. */
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
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Public quotation base URL must be HTTPS without credentials or query state.");
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

function candleRequestPath(market: string, count: number): string {
  // Do not build this with URL.searchParams. Real Android/Hermes evidence showed that mutating
  // searchParams could leave url.search empty even though Node tests passed, causing the required
  // market/count query to disappear on the wire. Construct the already-validated query directly.
  return `${UPBIT_PUBLIC_CANDLE_PATH}?market=${encodeURIComponent(market)}&count=${count}`;
}

function resolvedRequestUrl(path: string, options: UpbitPublicQuotationClientOptions): string {
  // Android production uses the isolated native transport before this fallback is reached.
  // Tests, development overrides, iOS and old native binaries retain the ordinary public GET path.
  return `${normalizedBaseUrl(options.baseUrl)}${path}`;
}

/** Everything a real-device failure needs to confirm root cause without credential exposure. */
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

function errorDetail(payload: unknown): { readonly name?: string; readonly message?: string } {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return Object.freeze({});
  const record = payload as Record<string, unknown>;
  if (record.error != null && typeof record.error === "object" && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>;
    return Object.freeze({ name: compactErrorText(error.name), message: compactErrorText(error.message) });
  }
  return Object.freeze({ message: compactErrorText(record.error) });
}

async function upstreamDiagnostic(requestUrl: string, response: Response): Promise<PublicQuotationDiagnostic> {
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    payload = undefined;
  }
  const detail = errorDetail(payload);
  const nativeDiagnostic = await readNativeRequestDiagnostic().catch(() => null);
  return Object.freeze({
    requestUrl,
    method: "GET" as const,
    status: response.status,
    responseErrorName: detail.name,
    responseErrorMessage: detail.message,
    responseContentType: response.headers.get("content-type") ?? undefined,
    finalUserAgent: nativeDiagnostic?.userAgent ?? undefined,
    timestamp: new Date().toISOString(),
  });
}

function nativeResponseJson(response: NativeUpbitPublicQuotationResponse): unknown {
  let payload: unknown;
  try {
    payload = JSON.parse(response.body) as unknown;
  } catch {
    payload = undefined;
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = errorDetail(payload);
    const diagnostic: PublicQuotationDiagnostic = Object.freeze({
      requestUrl: response.requestUrl,
      method: "GET" as const,
      status: response.status,
      responseErrorName: detail.name,
      responseErrorMessage: detail.message,
      responseContentType: response.contentType ?? undefined,
      finalUserAgent: response.userAgent,
      timestamp: new Date().toISOString(),
    });
    const suffix = [detail.name, detail.message].filter(Boolean).join(": ");
    throw new UpbitPublicQuotationError(
      `Upbit public quotation unavailable (${response.status}${suffix ? `: ${suffix}` : ""}).`,
      diagnostic,
    );
  }
  if (payload === undefined) throw new Error("Upbit public quotation response is invalid.");
  return payload;
}

async function requestJson(path: string, options: UpbitPublicQuotationClientOptions): Promise<unknown> {
  const request = options.request ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(options.timeoutMs));
  const requestUrl = resolvedRequestUrl(path, options);
  try {
    const response = await request(requestUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
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

/** Shared row shape between Upbit REST ticker and DEFAULT-format WebSocket ticker. */
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
  if (options.request === undefined && options.baseUrl === undefined) {
    let nativeResponse: NativeUpbitPublicQuotationResponse | null;
    try {
      nativeResponse = await requestNativeAndroidUpbitTicker(timeoutMs(options.timeoutMs));
    } catch {
      throw new Error("Upbit public quotation request failed.");
    }
    if (nativeResponse != null) return normalizeUpbitTickerPayload(nativeResponseJson(nativeResponse));
  }
  return normalizeUpbitTickerPayload(await requestJson(UPBIT_PUBLIC_TICKER_PATH, options));
}

export function normalizeUpbitCandlePayload(raw: unknown, market: string): readonly PublicCandle[] {
  return parsePublicCandles(raw, normalizedMarket(market));
}

export async function loadUpbitPublicCandles(options: UpbitPublicCandleOptions): Promise<readonly PublicCandle[]> {
  const market = normalizedMarket(options.market);
  const count = boundedCount(options.count);
  if (options.request === undefined && options.baseUrl === undefined) {
    let nativeResponse: NativeUpbitPublicQuotationResponse | null;
    try {
      nativeResponse = await requestNativeAndroidUpbitCandles(market, count, timeoutMs(options.timeoutMs));
    } catch {
      throw new Error("Upbit public quotation request failed.");
    }
    if (nativeResponse != null) return normalizeUpbitCandlePayload(nativeResponseJson(nativeResponse), market);
  }
  const path = candleRequestPath(market, count);
  return normalizeUpbitCandlePayload(await requestJson(path, options), market);
}
