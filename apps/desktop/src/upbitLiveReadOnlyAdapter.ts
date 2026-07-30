import { createHash, createHmac, randomUUID } from "node:crypto";

export interface UpbitLiveCredentials {
  accessKey: string;
  secretKey: string;
}

export interface UpbitAccountBalance {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
  avg_buy_price_modified: boolean;
  unit_currency: string;
}

export interface UpbitOrder {
  uuid: string;
  side: "bid" | "ask";
  ord_type: string;
  price: string | null;
  state: string;
  market: string;
  created_at: string;
  volume: string | null;
  remaining_volume: string | null;
  reserved_fee: string;
  remaining_fee: string;
  paid_fee: string;
  locked: string;
  executed_volume: string;
  trades_count: number;
}

export interface UpbitLiveReadOnlySnapshot {
  observedAt: string;
  accounts: UpbitAccountBalance[];
  openOrders: UpbitOrder[];
}

export interface UpbitLiveReadOnlyAdapterOptions {
  credentials: UpbitLiveCredentials;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class LiveMutationDisabledError extends Error {
  constructor(operation: string) {
    super(`Live mutation is disabled: ${operation}`);
    this.name = "LiveMutationDisabledError";
  }
}

/**
 * Authenticated Upbit adapter that deliberately exposes observation only.
 *
 * Safety boundary:
 * - account, order and fill-related reads are allowed;
 * - order creation, cancellation and withdrawal are technically unavailable;
 * - credentials are accepted at runtime but are never persisted here.
 */
export class UpbitLiveReadOnlyAdapter {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: UpbitLiveReadOnlyAdapterOptions) {
    const accessKey = options.credentials.accessKey.trim();
    const secretKey = options.credentials.secretKey.trim();

    if (!accessKey || !secretKey) {
      throw new Error("Upbit live credentials are required");
    }

    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.baseUrl = (options.baseUrl ?? "https://api.upbit.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async getAccounts(signal?: AbortSignal): Promise<UpbitAccountBalance[]> {
    return this.request<UpbitAccountBalance[]>("GET", "/v1/accounts", undefined, signal);
  }

  async getOpenOrders(market?: string, signal?: AbortSignal): Promise<UpbitOrder[]> {
    const query: Record<string, string> = { state: "wait" };
    if (market) query.market = market;
    return this.request<UpbitOrder[]>("GET", "/v1/orders", query, signal);
  }

  async getOrder(uuid: string, signal?: AbortSignal): Promise<UpbitOrder> {
    const normalized = uuid.trim();
    if (!normalized) throw new Error("Order UUID is required");
    return this.request<UpbitOrder>("GET", "/v1/order", { uuid: normalized }, signal);
  }

  async captureSnapshot(market?: string, signal?: AbortSignal): Promise<UpbitLiveReadOnlySnapshot> {
    const [accounts, openOrders] = await Promise.all([
      this.getAccounts(signal),
      this.getOpenOrders(market, signal),
    ]);

    return {
      observedAt: this.now().toISOString(),
      accounts,
      openOrders,
    };
  }

  async submitOrder(): Promise<never> {
    throw new LiveMutationDisabledError("submitOrder");
  }

  async cancelOrder(): Promise<never> {
    throw new LiveMutationDisabledError("cancelOrder");
  }

  async withdraw(): Promise<never> {
    throw new LiveMutationDisabledError("withdraw");
  }

  private async request<T>(
    method: "GET",
    path: string,
    query?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const queryString = query ? new URLSearchParams(query).toString() : "";
    const url = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
    const authorization = this.createAuthorization(queryString);

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
      signal,
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Upbit returned invalid JSON (${response.status})`);
    }

    if (!response.ok) {
      const message = this.extractErrorMessage(payload) ?? response.statusText;
      throw new Error(`Upbit read request failed (${response.status}): ${message}`);
    }

    return payload as T;
  }

  private createAuthorization(queryString: string): string {
    const payload: Record<string, string> = {
      access_key: this.accessKey,
      nonce: randomUUID(),
    };

    if (queryString) {
      payload.query_hash = createHash("sha512").update(queryString, "utf8").digest("hex");
      payload.query_hash_alg = "SHA512";
    }

    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = this.base64Url(JSON.stringify(header));
    const encodedPayload = this.base64Url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", this.secretKey)
      .update(unsignedToken, "utf8")
      .digest("base64url");

    return `Bearer ${unsignedToken}.${signature}`;
  }

  private base64Url(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
  }

  private extractErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== "object") return null;
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
}
