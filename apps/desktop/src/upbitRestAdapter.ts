import { createHash, createHmac, randomUUID } from "node:crypto";

export interface UpbitCredentials {
  readonly accessKey: string;
  readonly secretKey: string;
}

export interface UpbitAccountBalance {
  readonly currency: string;
  readonly balance: string;
  readonly locked: string;
  readonly avg_buy_price: string;
  readonly avg_buy_price_modified: boolean;
  readonly unit_currency: string;
}

export interface UpbitOrder {
  readonly uuid: string;
  readonly side: "bid" | "ask";
  readonly ord_type: string;
  readonly price: string | null;
  readonly state: string;
  readonly market: string;
  readonly created_at: string;
  readonly volume: string | null;
  readonly remaining_volume: string | null;
  readonly reserved_fee: string;
  readonly remaining_fee: string;
  readonly paid_fee: string;
  readonly locked: string;
  readonly executed_volume: string;
  readonly trades_count: number;
}

export interface UpbitOrderChance {
  readonly bid_fee: string;
  readonly ask_fee: string;
  readonly maker_bid_fee: string;
  readonly maker_ask_fee: string;
  readonly market: {
    readonly id: string;
    readonly name: string;
    readonly order_types: readonly string[];
    readonly order_sides: readonly string[];
    readonly bid: { readonly currency: string; readonly min_total: string };
    readonly ask: { readonly currency: string; readonly min_total: string };
  };
}

export interface UpbitLiveReadOnlySnapshot {
  readonly observedAt: string;
  readonly accounts: readonly UpbitAccountBalance[];
  readonly openOrders: readonly UpbitOrder[];
}

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

export interface UpbitRestClientOptions {
  readonly credentials: UpbitCredentials;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly nonce?: () => string;
  readonly retry?: Partial<UpbitRetryPolicy>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface UpbitRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface UpbitOrderQuery {
  readonly market?: string;
  readonly state?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface UpbitReadAdapter {
  getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]>;
  getOrders(query?: UpbitOrderQuery, signal?: AbortSignal): Promise<readonly UpbitOrder[]>;
  getOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]>;
  getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder>;
  getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance>;
  captureSnapshot(market?: string, signal?: AbortSignal): Promise<UpbitLiveReadOnlySnapshot>;
}

export interface UpbitOrderAdapter extends UpbitReadAdapter {
  testOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder>;
  submitOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder>;
  cancelOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder>;
}

export class UpbitConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpbitConfigurationError";
  }
}

export class UpbitApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(`Upbit request failed (${status}): ${message}`);
    this.name = "UpbitApiError";
  }
}

export class UpbitTransportError extends Error {
  constructor(message: string) {
    super(`Upbit transport failed: ${message}`);
    this.name = "UpbitTransportError";
  }
}

export class LiveMutationDisabledError extends Error {
  constructor(operation: string) {
    super(`Live mutation is disabled: ${operation}`);
    this.name = "LiveMutationDisabledError";
  }
}

export function loadUpbitCredentials(environment: NodeJS.ProcessEnv = process.env): UpbitCredentials {
  const accessKey = environment.UPBIT_ACCESS_KEY?.trim() ?? "";
  const secretKey = environment.UPBIT_SECRET_KEY?.trim() ?? "";
  if (!accessKey || !secretKey) {
    throw new UpbitConfigurationError("UPBIT_ACCESS_KEY and UPBIT_SECRET_KEY are required");
  }
  return Object.freeze({ accessKey, secretKey });
}

export function createUpbitJwt(
  credentials: UpbitCredentials,
  options: { readonly queryString?: string; readonly nonce?: string } = {},
): string {
  const accessKey = credentials.accessKey.trim();
  const secretKey = credentials.secretKey.trim();
  if (!accessKey || !secretKey) throw new UpbitConfigurationError("Upbit credentials are required");

  const claims: Record<string, string> = {
    access_key: accessKey,
    nonce: options.nonce ?? randomUUID(),
  };
  if (options.queryString) {
    claims.query_hash = createHash("sha512").update(options.queryString, "utf8").digest("hex");
    claims.query_hash_alg = "SHA512";
  }

  const encodedHeader = base64Url(JSON.stringify({ alg: "HS512", typ: "JWT" }));
  const encodedPayload = base64Url(JSON.stringify(claims));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha512", secretKey).update(unsignedToken, "utf8").digest("base64url");
  return `Bearer ${unsignedToken}.${signature}`;
}

export function mapUpbitError(status: number, payload: unknown, statusText = "request failed", retryAfterMs?: number): UpbitApiError {
  const error = payload && typeof payload === "object" && "error" in payload ? (payload as { error?: unknown }).error : undefined;
  const details = error && typeof error === "object" ? error as { name?: unknown; message?: unknown } : {};
  const message = typeof details.message === "string" && details.message ? details.message : statusText;
  const code = typeof details.name === "string" ? details.name : undefined;
  return new UpbitApiError(status, code, message, status === 429 || status >= 500, retryAfterMs);
}

const DEFAULT_RETRY: UpbitRetryPolicy = Object.freeze({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 2_000 });

export class UpbitRestClient implements UpbitOrderAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly nonce: () => string;
  private readonly retry: UpbitRetryPolicy;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly credentials: UpbitCredentials;

  constructor(options: UpbitRestClientOptions) {
    const accessKey = options.credentials.accessKey.trim();
    const secretKey = options.credentials.secretKey.trim();
    if (!accessKey || !secretKey) throw new UpbitConfigurationError("Upbit credentials are required");
    this.baseUrl = (options.baseUrl ?? "https://api.upbit.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.nonce = options.nonce ?? randomUUID;
    this.retry = normalizeRetry(options.retry);
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.credentials = Object.freeze({ accessKey, secretKey });
  }

  async getAccounts(signal?: AbortSignal): Promise<readonly UpbitAccountBalance[]> {
    return this.request<readonly UpbitAccountBalance[]>("GET", "/v1/accounts", undefined, undefined, signal);
  }

  async getOrders(query: UpbitOrderQuery = {}, signal?: AbortSignal): Promise<readonly UpbitOrder[]> {
    const normalized: Record<string, string> = {};
    if (query.market?.trim()) normalized.market = query.market.trim();
    if (query.state?.trim()) normalized.state = query.state.trim();
    if (query.page !== undefined) normalized.page = positiveInteger(query.page, "page");
    if (query.limit !== undefined) normalized.limit = positiveInteger(query.limit, "limit");
    return this.request<readonly UpbitOrder[]>("GET", "/v1/orders", normalized, undefined, signal);
  }

  async getOpenOrders(market?: string, signal?: AbortSignal): Promise<readonly UpbitOrder[]> {
    return this.getOrders({ market, state: "wait" }, signal);
  }

  async getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder> {
    const normalized = requiredText(uuid, "Order UUID");
    return this.request<UpbitOrder>("GET", "/v1/order", { uuid: normalized }, undefined, signal);
  }

  async getOrderChance(market: string, signal?: AbortSignal): Promise<UpbitOrderChance> {
    const normalized = requiredText(market, "Market");
    return this.request<UpbitOrderChance>("GET", "/v1/orders/chance", { market: normalized }, undefined, signal);
  }

  async captureSnapshot(market?: string, signal?: AbortSignal): Promise<UpbitLiveReadOnlySnapshot> {
    const [accounts, openOrders] = await Promise.all([this.getAccounts(signal), this.getOpenOrders(market, signal)]);
    return Object.freeze({ observedAt: this.now().toISOString(), accounts, openOrders });
  }

  async testOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder> {
    const body = normalizeOrder(order);
    return this.request<UpbitOrder>("POST", "/v1/orders/test", undefined, body, signal);
  }

  async submitOrder(order: UpbitSubmitOrderRequest, signal?: AbortSignal): Promise<UpbitOrder> {
    const body = normalizeOrder(order);
    return this.request<UpbitOrder>("POST", "/v1/orders", undefined, body, signal);
  }

  async cancelOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder> {
    const normalized = requiredText(uuid, "Order UUID");
    return this.request<UpbitOrder>("DELETE", "/v1/order", { uuid: normalized }, undefined, signal);
  }

  async withdraw(): Promise<never> {
    throw new LiveMutationDisabledError("withdraw");
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    query: Record<string, string> | undefined,
    body: Record<string, string> | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const queryString = query ? new URLSearchParams(query).toString() : "";
    const bodyQueryString = body ? new URLSearchParams(body).toString() : "";
    const authQueryString = bodyQueryString || queryString;
    const url = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
    const maxAttempts = method === "GET" ? this.retry.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
        if (attempt < maxAttempts) {
          await this.sleep(backoff(attempt, this.retry));
          continue;
        }
        throw new UpbitTransportError(error instanceof Error ? error.message : String(error));
      }

      const text = await response.text();
      const payload = parseJson(text, response.status);
      if (response.ok) return payload as T;
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const mapped = mapUpbitError(response.status, payload, response.statusText, retryAfterMs);
      if (method !== "GET" || !mapped.retryable || attempt >= maxAttempts) throw mapped;
      await this.sleep(mapped.retryAfterMs ?? backoff(attempt, this.retry));
    }
    throw new UpbitTransportError("request retry loop ended unexpectedly");
  }
}

export interface MockUpbitRestAdapterFixtures {
  readonly accounts?: readonly UpbitAccountBalance[];
  readonly orders?: readonly UpbitOrder[];
  readonly orderChance?: UpbitOrderChance;
}

export class MockUpbitRestAdapter implements UpbitReadAdapter {
  private readonly fixtures: Required<MockUpbitRestAdapterFixtures>;
  constructor(fixtures: MockUpbitRestAdapterFixtures = {}) {
    this.fixtures = {
      accounts: fixtures.accounts ?? [],
      orders: fixtures.orders ?? [],
      orderChance: fixtures.orderChance ?? defaultOrderChance(),
    };
  }
  async getAccounts(): Promise<readonly UpbitAccountBalance[]> { return this.fixtures.accounts; }
  async getOrders(query: UpbitOrderQuery = {}): Promise<readonly UpbitOrder[]> {
    return this.fixtures.orders.filter((order) => (!query.market || order.market === query.market) && (!query.state || order.state === query.state));
  }
  async getOpenOrders(market?: string): Promise<readonly UpbitOrder[]> { return this.getOrders({ market, state: "wait" }); }
  async getOrder(uuid: string): Promise<UpbitOrder> {
    const order = this.fixtures.orders.find((candidate) => candidate.uuid === uuid.trim());
    if (!order) throw new UpbitApiError(404, "order_not_found", "order not found", false);
    return order;
  }
  async getOrderChance(_market?: string): Promise<UpbitOrderChance> { return this.fixtures.orderChance; }
  async captureSnapshot(): Promise<UpbitLiveReadOnlySnapshot> { return Object.freeze({ observedAt: new Date(0).toISOString(), accounts: this.fixtures.accounts, openOrders: this.fixtures.orders.filter((order) => order.state === "wait") }); }
}

function base64Url(value: string): string { return Buffer.from(value, "utf8").toString("base64url"); }
function positiveInteger(value: number, name: string): string { if (!Number.isSafeInteger(value) || value < 1) throw new UpbitConfigurationError(`${name} must be a positive integer`); return String(value); }
function requiredText(value: string, name: string): string { const normalized = value.trim(); if (!normalized) throw new UpbitConfigurationError(`${name} is required`); return normalized; }
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
function backoff(attempt: number, retry: UpbitRetryPolicy): number { return Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1)); }
function normalizeRetry(value: Partial<UpbitRetryPolicy> | undefined): UpbitRetryPolicy {
  const retry = { ...DEFAULT_RETRY, ...value };
  if (!Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.baseDelayMs < 0 || retry.maxDelayMs < retry.baseDelayMs) throw new UpbitConfigurationError("invalid Upbit retry policy");
  return Object.freeze(retry);
}
function defaultOrderChance(): UpbitOrderChance { return Object.freeze({ bid_fee: "0.0005", ask_fee: "0.0005", maker_bid_fee: "0.0005", maker_ask_fee: "0.0005", market: { id: "KRW-BTC", name: "Bitcoin", order_types: ["limit", "price", "market"], order_sides: ["ask", "bid"], bid: { currency: "KRW", min_total: "5000" }, ask: { currency: "BTC", min_total: "5000" } } }); }
