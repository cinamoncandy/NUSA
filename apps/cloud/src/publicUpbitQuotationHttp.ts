import { dashboardJsonResponse, type DashboardHttpResponse } from "./mobileDashboardHttp";

export const PUBLIC_UPBIT_TICKER_PATH = "/api/public/upbit/ticker";
export const PUBLIC_UPBIT_CANDLE_PATH = "/api/public/upbit/candles";
export const UPBIT_PUBLIC_TICKER_URL = "https://api.upbit.com/v1/ticker/all?quote_currencies=KRW";
export const UPBIT_PUBLIC_CANDLE_URL = "https://api.upbit.com/v1/candles/minutes/1";
export const MAX_PUBLIC_CANDLE_COUNT = 200;
const DEFAULT_PUBLIC_CANDLE_COUNT = 120;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MARKET_PATTERN = /^KRW-[A-Z0-9]+$/;

export function isPublicUpbitQuotationPath(pathname: string): boolean {
  return pathname === PUBLIC_UPBIT_TICKER_PATH || pathname === PUBLIC_UPBIT_CANDLE_PATH;
}

function normalizedMarket(value: string | null): string | null {
  if (value == null) return null;
  const market = value.trim().toUpperCase();
  return MARKET_PATTERN.test(market) ? market : null;
}

function boundedCount(value: string | null): number | null {
  if (value == null || value === "") return DEFAULT_PUBLIC_CANDLE_COUNT;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 && count <= MAX_PUBLIC_CANDLE_COUNT ? count : null;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`upstream status ${response.status}`);
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) throw new Error("upstream payload is not an array");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function handlePublicUpbitQuotationHttp(
  requestUrl: string,
  method: string,
  fetchImpl: typeof fetch = fetch
): Promise<DashboardHttpResponse> {
  if (method.toUpperCase() !== "GET") {
    const base = dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    return Object.freeze({ ...base, headers: Object.freeze({ ...base.headers, allow: "GET" }) });
  }

  let url: URL;
  try {
    url = new URL(requestUrl, "http://localhost");
  } catch {
    return dashboardJsonResponse(400, { error: "INVALID_REQUEST" });
  }

  let upstreamUrl: string;
  if (url.pathname === PUBLIC_UPBIT_TICKER_PATH) {
    if ([...url.searchParams.keys()].length !== 0) return dashboardJsonResponse(400, { error: "INVALID_QUERY" });
    upstreamUrl = UPBIT_PUBLIC_TICKER_URL;
  } else if (url.pathname === PUBLIC_UPBIT_CANDLE_PATH) {
    for (const key of url.searchParams.keys()) {
      if (key !== "market" && key !== "count") return dashboardJsonResponse(400, { error: "INVALID_QUERY" });
    }
    const market = normalizedMarket(url.searchParams.get("market"));
    const count = boundedCount(url.searchParams.get("count"));
    if (market == null || count == null) return dashboardJsonResponse(400, { error: "INVALID_QUERY" });
    const upstream = new URL(UPBIT_PUBLIC_CANDLE_URL);
    upstream.searchParams.set("market", market);
    upstream.searchParams.set("count", String(count));
    upstreamUrl = upstream.toString();
  } else {
    return dashboardJsonResponse(404, { error: "NOT_FOUND" });
  }

  try {
    const payload = await fetchJson(upstreamUrl, fetchImpl);
    return dashboardJsonResponse(200, payload);
  } catch {
    return dashboardJsonResponse(502, { error: "UPSTREAM_FAILURE" });
  }
}
