import { describeBuildIdentity } from "./buildIdentity";

export type HttpMethod = "GET" | "POST";
export interface ApiRequest<TBody = unknown> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly body?: TBody;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly data: T;
}

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly transport?: ApiTransport;
}

export interface ApiTransport {
  request(input: Readonly<{ url: string; method: HttpMethod; body?: unknown; signal: AbortSignal }>): Promise<ApiResponse<unknown>>;
}

export class ApiClientError extends Error {
  public readonly status: number | null;
  public readonly code: "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_RESPONSE";
  public readonly retriable: boolean;

  public constructor(message: string, code: ApiClientError["code"], status: number | null = null, retriable = false) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.retriable = retriable;
  }
}

const DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_NUSA_API_BASE_URL ?? "http://127.0.0.1:41731";
const assertPositive = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`);
  return value;
};
const assertRetries = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("maxRetries must be a non-negative safe integer");
  return value;
};

const defaultTransport: ApiTransport = {
  async request(input) {
    try {
      const response = await fetch(input.url, {
        method: input.method,
        signal: input.signal,
        ...(input.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input.body) }),
      });
      let data: unknown;
      try { data = await response.json(); } catch { throw new ApiClientError("response body is not valid JSON", "INVALID_RESPONSE", response.status); }
      return { status: response.status, data };
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError("network request failed", "NETWORK_ERROR", null, true);
    }
  },
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly transport: ApiTransport;

  public constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    // Defense in depth behind manifest usesCleartextTraffic=false: a sealed
    // release build must never construct a cleartext client, not even for
    // loopback. Dev/unsealed builds keep the loopback default.
    if (this.baseUrl.startsWith("http://") && describeBuildIdentity().sealed) {
      throw new Error("cleartext ApiClient is forbidden in a sealed build");
    }
    this.timeoutMs = assertPositive(options.timeoutMs ?? 5000, "timeoutMs");
    this.maxRetries = options.maxRetries === undefined ? 2 : assertRetries(options.maxRetries);
    this.retryDelayMs = assertPositive(options.retryDelayMs ?? 100, "retryDelayMs");
    this.transport = options.transport ?? defaultTransport;
  }

  public get<T>(path: string): Promise<ApiResponse<T>> { return this.request<T>({ method: "GET", path }); }

  public post<T, TBody = unknown>(path: string, body: TBody): Promise<ApiResponse<T>> { return this.request<T, TBody>({ method: "POST", path, body }); }

  public async request<T, TBody = unknown>(request: ApiRequest<TBody>): Promise<ApiResponse<T>> {
    if (!request.path.startsWith("/")) throw new Error("path must start with '/'");
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.transport.request({ url: `${this.baseUrl}${request.path}`, method: request.method, body: request.body, signal: controller.signal });
        if (response.status >= 200 && response.status < 300) return { status: response.status, data: response.data as T };
        const retriable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new ApiClientError(`HTTP request failed (${response.status})`, "HTTP_ERROR", response.status, retriable);
      } catch (error) {
        const apiError = error instanceof ApiClientError ? error : new ApiClientError("network request failed", "NETWORK_ERROR", null, true);
        if (apiError.code === "NETWORK_ERROR" && controller.signal.aborted) throw new ApiClientError("request timed out", "TIMEOUT", null, true);
        if (!apiError.retriable || attempt >= this.maxRetries) throw apiError;
        await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs * (2 ** attempt)));
        attempt += 1;
      } finally { clearTimeout(timer); }
    }
  }
}

export function createMockTransport(responses: readonly ApiResponse<unknown>[]): ApiTransport {
  let index = 0;
  return { async request() { const response = responses[Math.min(index++, responses.length - 1)]; if (response === undefined) throw new ApiClientError("mock response missing", "NETWORK_ERROR", null, false); return response; } };
}
