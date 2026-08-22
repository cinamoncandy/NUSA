import { randomUUID } from "node:crypto";
import {
  LiveMutationDisabledError,
  UpbitApiError,
  UpbitConfigurationError,
  UpbitTransportError,
  createUpbitJwt,
  mapUpbitError,
  type UpbitAccountBalance,
  type UpbitCredentials,
  type UpbitLiveReadOnlySnapshot,
  type UpbitOrder,
  type UpbitOrderChance,
  type UpbitOrderQuery,
} from "./upbitRestAdapter";

export type UpbitOrderSide = "bid" | "ask";
export type UpbitOrderType = "limit" | "price" | "market" | "best";

export interface UpbitSubmitOrderRequest {
  readonly market: string;
  readonly side: UpbitOrderSide;
  readonly ord_type: UpbitOrderType;
  readonly volume?: string;
  readonly price?: string;
  readonly identifier?: string;
  readonly time_in_force?: "ioc" | "fok" | "post_only";
  readonly smp_type?: "cancel_maker" | "cancel_taker" | "reduce";
}

export interface UpbitExecutionClientOptions {
  readonly credentials: UpbitCredentials;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly nonce?: () => string;
}

export interface UpbitOrderAdapter {
  getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]>;
  getOrders(query?: UpbitOrderQuery, signal?: AbortSignal): Promise<readonly UpbitOrder[]>;
  getOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]>;
  getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder>;
  getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance>;
  captureSnapshot(market?: string, signal?: AbortSignal): Promise<UpbitLiveReadOnlySnapshot>;
  testOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder>;
  submitOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<never>;
  cancelOrder(uuid: string, signal?: AbortSignal): Promise<never>;
  withdraw(): Promise<never>;
}

export class UpbitExecutionRestClient implements UpbitOrderAdapter {
  private readonly credentials: UpbitCredentials;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nonce: () => string;

  constructor(options: UpbitExecutionClientOptions) {
    const accessKey = options.credentials.accessKey.trim();
    const secretKey = options.credentials.secretKey.trim();
    if (!accessKey || !secretKey) throw new UpbitConfigurationError("Upbit credentials are required");
    this.credentials = Object.freeze({ accessKey, secretKey });
    this.baseUrl = (options.baseUrl ?? "https://api.upbit.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nonce = options.nonce ?? randomUUID;
  }

  async getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]> { return this.request("GET", "/v1/accounts", undefined, undefined, signal); }
  async getOrders(query: UpbitOrderQuery = {}, signal?: AbortSignal): Promise<readonly UpbitOrder[]> {
    const parameters: Record<string, string> = {};
    if (query.market?.trim()) parameters.market = query.market.trim();
    if (query.state?.trim()) parameters.state = query.state.trim();
    if (query.page !== undefined) parameters.page = positiveInteger(query.page, "page");
    if (query.limit !== undefined) parameters.limit = positiveInteger(query.limit, "limit");
    return this.request("GET", "/v1/orders", parameters, undefined, signal);
  }
  async getOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]> { return this.getOrders({ market, state: "wait" }, signal); }
  async getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder> { return this.request("GET", "/v1/order", { uuid: requiredText(uuid, "Order UUID") }, undefined, signal); }
  async getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance> { return this.request("GET", "/v1/orders/chance", { market: requiredText(market, "Market") }, undefined, signal); }
  async captureSnapshot(market?: string, signal?: AbortSignal): Promise<UpbitLiveReadOnlySnapshot> {
    const [accounts, openOrders] = await Promise.all([this.getAccounts(signal), this.getOpenOrders(market, signal)]);
    return Object.freeze({ observedAt: new Date().toISOString(), accounts, openOrders });
  }
  async testOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder> {
    return this.request("POST", "/v1/orders/test", undefined, normalizeOrder(order), signal);
  }
  async submitOrder(_order: UpbitSubmitOrderRequest, _signal?: AbortSignal): Promise<never> {
    throw new LiveMutationDisabledError("LIVE:submitOrder:restricted-live-artifact-required");
  }
  async cancelOrder(_uuid: string, _signal?: AbortSignal): Promise<never> {
    throw new LiveMutationDisabledError("LIVE:cancelOrder:restricted-live-artifact-required");
  }
  async withdraw(): Promise<never> { throw new LiveMutationDisabledError("LIVE:withdraw"); }

  private async request<T>(method: "GET" | "POST", path: string, query: Record<string, string> | undefined, body: Record<string, string> | undefined, signal?: AbortSignal): Promise<T> {
    const queryString = query ? new URLSearchParams(query).toString() : "";
    const authParameters = body ?? query;
    const authQueryString = authParameters ? Object.entries(authParameters).map(([key, value]) => `${key}=${value}`).join("&") : "";
    const url = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { Authorization: createUpbitJwt(this.credentials, { queryString: authQueryString, nonce: this.nonce() }), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
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

function requiredText(value: string, name: string): string { const normalized = value.trim(); if (!normalized) throw new UpbitConfigurationError(`${name} is required`); return normalized; }
function positiveInteger(value: number, name: string): string { if (!Number.isSafeInteger(value) || value < 1) throw new UpbitConfigurationError(`${name} must be a positive integer`); return String(value); }
function positiveDecimal(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) || Number(normalized) <= 0) throw new UpbitConfigurationError(`${name} must be a positive decimal string`);
  return normalized;
}
function normalizeOrder(order: UpbitSubmitOrderRequest): Record<string, string> {
  const market = requiredText(order.market, "Market");
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(market)) throw new UpbitConfigurationError("Market must use quote-base format such as KRW-BTC");
  const volume = positiveDecimal(order.volume, "volume");
  const price = positiveDecimal(order.price, "price");
  if (order.ord_type === "limit" && (!volume || !price)) throw new UpbitConfigurationError("limit order requires volume and price");
  if (order.ord_type === "price" && (order.side !== "bid" || !price || volume)) throw new UpbitConfigurationError("price order is a market buy and requires price only");
  if (order.ord_type === "market" && (order.side !== "ask" || !volume || price)) throw new UpbitConfigurationError("market order is a market sell and requires volume only");
  if (order.ord_type === "best" && !volume && !price) throw new UpbitConfigurationError("best order requires volume or price");
  if (order.time_in_force === "post_only" && order.smp_type) throw new UpbitConfigurationError("post_only cannot be combined with smp_type");
  const body: Record<string, string> = { market, side: order.side, ord_type: order.ord_type };
  if (volume) body.volume = volume;
  if (price) body.price = price;
  if (order.identifier?.trim()) body.identifier = order.identifier.trim();
  if (order.time_in_force) body.time_in_force = order.time_in_force;
  if (order.smp_type) body.smp_type = order.smp_type;
  return body;
}
function parseJson(text: string, status: number): unknown { if (!text) return null; try { return JSON.parse(text) as unknown; } catch { throw new UpbitApiError(status, "invalid_json", "Upbit returned invalid JSON", false); } }
function parseRetryAfter(value: string | null): number | undefined { if (!value) return undefined; const seconds = Number(value); return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1_000, 60_000) : undefined; }
