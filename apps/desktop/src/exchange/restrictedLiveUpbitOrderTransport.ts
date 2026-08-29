import { randomUUID } from "node:crypto";
import {
  UpbitApiError,
  UpbitConfigurationError,
  UpbitTransportError,
  createUpbitJwt,
  mapUpbitError,
  type UpbitCredentials,
  type UpbitOrder,
} from "./upbitRestAdapter";
import type { UpbitSubmitOrderRequest } from "./upbitExecutionRestClient";

export interface RestrictedLiveUpbitOrderTransportOptions {
  readonly credentials: UpbitCredentials;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly nonce?: () => string;
  readonly maxOrderAmountKrw: number;
}

/**
 * Real Upbit mutation transport. This class intentionally has no environment-switch logic.
 * It must be constructed only by the Restricted-LIVE composition root after every outer
 * safety gate has passed.
 */
export class RestrictedLiveUpbitOrderTransport {
  private readonly credentials: UpbitCredentials;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nonce: () => string;
  private readonly maxOrderAmountKrw: number;

  constructor(options: RestrictedLiveUpbitOrderTransportOptions) {
    const accessKey = options.credentials.accessKey.trim();
    const secretKey = options.credentials.secretKey.trim();
    if (!accessKey || !secretKey) throw new UpbitConfigurationError("Upbit credentials are required");
    if (!Number.isSafeInteger(options.maxOrderAmountKrw) || options.maxOrderAmountKrw < 5_000) {
      throw new UpbitConfigurationError("Restricted-LIVE max order amount must be an integer >= 5000 KRW");
    }
    this.credentials = Object.freeze({ accessKey, secretKey });
    this.baseUrl = (options.baseUrl ?? "https://api.upbit.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nonce = options.nonce ?? randomUUID;
    this.maxOrderAmountKrw = options.maxOrderAmountKrw;
  }

  async submitOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder> {
    const body = normalizeLiveOrder(order);
    enforceKrwOrderCap(body, this.maxOrderAmountKrw);
    return this.request("POST", "/v1/orders", undefined, body, signal);
  }

  async cancelOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder> {
    const normalized = uuid.trim();
    if (!normalized) throw new UpbitConfigurationError("Order UUID is required");
    return this.request("DELETE", "/v1/order", { uuid: normalized }, undefined, signal);
  }

  async getOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]> {
    const query: Record<string, string> = { state: "wait" };
    if (market?.trim()) query.market = market.trim();
    return this.request("GET", "/v1/orders", query, undefined, signal);
  }

  async cancelAllOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]> {
    const open = await this.getOpenOrders(market, signal);
    const cancelled: UpbitOrder[] = [];
    for (const order of open) cancelled.push(await this.cancelOrder(order.uuid, signal));
    return Object.freeze(cancelled);
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    query: Record<string, string> | undefined,
    body: Record<string, string> | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const queryString = query ? new URLSearchParams(query).toString() : "";
    const authParameters = body ?? query;
    const authQueryString = authParameters ? Object.entries(authParameters).map(([key, value]) => `${key}=${value}`).join("&") : "";
    const url = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: createUpbitJwt(this.credentials, { queryString: authQueryString, nonce: this.nonce() }),
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch (error) {
      throw new UpbitTransportError(error instanceof Error ? error.message : String(error));
    }
    const text = await response.text();
    const payload = parseJson(text, response.status);
    if (response.ok) return payload as T;
    throw mapUpbitError(response.status, payload, response.statusText, parseRetryAfter(response.headers.get("retry-after")));
  }
}

function normalizeLiveOrder(order: UpbitSubmitOrderRequest): Record<string, string> {
  const market = order.market.trim();
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(market)) throw new UpbitConfigurationError("Market must use quote-base format such as KRW-BTC");
  if (order.side !== "bid" && order.side !== "ask") throw new UpbitConfigurationError("Invalid order side");
  if (!["limit", "price", "market", "best"].includes(order.ord_type)) throw new UpbitConfigurationError("Invalid order type");
  const volume = positiveDecimal(order.volume, "volume");
  const price = positiveDecimal(order.price, "price");
  if (order.ord_type === "limit" && (!volume || !price)) throw new UpbitConfigurationError("limit order requires volume and price");
  if (order.ord_type === "price" && (order.side !== "bid" || !price || volume)) throw new UpbitConfigurationError("price order requires bid side and price only");
  if (order.ord_type === "market" && (order.side !== "ask" || !volume || price)) throw new UpbitConfigurationError("market order requires ask side and volume only");
  if (order.ord_type === "best") throw new UpbitConfigurationError("best orders are disabled in Restricted-LIVE until separately qualified");
  if (order.time_in_force || order.smp_type) throw new UpbitConfigurationError("time_in_force and SMP are disabled in Restricted-LIVE until separately qualified");
  const body: Record<string, string> = { market, side: order.side, ord_type: order.ord_type };
  if (volume) body.volume = volume;
  if (price) body.price = price;
  body.identifier = order.identifier?.trim() || `nusa-${randomUUID()}`;
  return body;
}

function enforceKrwOrderCap(body: Record<string, string>, maxOrderAmountKrw: number): void {
  if (!body.market.startsWith("KRW-")) throw new UpbitConfigurationError("Restricted-LIVE currently permits KRW markets only");
  if (body.side === "bid" && body.ord_type === "price") {
    if (Number(body.price) > maxOrderAmountKrw) throw new UpbitConfigurationError(`Order exceeds Restricted-LIVE cap of ${maxOrderAmountKrw} KRW`);
    return;
  }
  if (body.side === "bid" && body.ord_type === "limit") {
    const notional = Number(body.price) * Number(body.volume);
    if (!Number.isFinite(notional) || notional > maxOrderAmountKrw) throw new UpbitConfigurationError(`Order exceeds Restricted-LIVE cap of ${maxOrderAmountKrw} KRW`);
  }
}

function positiveDecimal(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) || Number(normalized) <= 0) throw new UpbitConfigurationError(`${name} must be a positive decimal string`);
  return normalized;
}

function parseJson(text: string, status: number): unknown {
  if (!text) return null;
  try { return JSON.parse(text) as unknown; }
  catch { throw new UpbitApiError(status, "invalid_json", "Upbit returned invalid JSON", false); }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1_000, 60_000) : undefined;
}
