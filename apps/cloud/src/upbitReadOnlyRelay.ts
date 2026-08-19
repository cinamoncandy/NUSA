import {
  authorizeDashboardReadRequest,
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardTokenVerifier
} from "./mobileDashboardHttp";

export const DEFAULT_UPBIT_READONLY_RELAY_ORIGIN = "http://127.0.0.1:3001";
export const UPBIT_READONLY_ROUTE_PATHS = Object.freeze({
  accountSummary: "/api/v1/account/summary",
  ordersOpen: "/api/v1/orders/open",
  ordersHistory: "/api/v1/orders/history"
});

export interface UpbitReadOnlyRelay {
  readonly read: (path: string) => Promise<DashboardHttpResponse>;
}

export interface UpbitReadOnlyRelayOptions {
  readonly origin?: string;
  readonly bridgeToken?: string;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface UpbitReadOnlyHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly relay: UpbitReadOnlyRelay;
}

const relayUnavailable = (): DashboardHttpResponse => dashboardJsonResponse(503, { error: "UPBIT_READONLY_UNAVAILABLE" });

function normalizeOrigin(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error("Upbit read-only relay origin is invalid"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Upbit read-only relay origin must not contain credentials or path state");
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Upbit read-only relay must use HTTPS unless loopback-only");
  return url.origin;
}

function readTimeout(value: number | undefined): number {
  const timeout = value ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 30_000) throw new Error("Upbit read-only relay timeout is invalid");
  return timeout;
}

function parseJson(body: string): unknown {
  try { return JSON.parse(body) as unknown; } catch { return undefined; }
}

/** Creates the server-only bridge to the existing Upbit read-only relay. */
export function createUpbitReadOnlyRelay(options: UpbitReadOnlyRelayOptions = {}): UpbitReadOnlyRelay {
  const origin = normalizeOrigin(options.origin ?? DEFAULT_UPBIT_READONLY_RELAY_ORIGIN);
  const bridgeToken = options.bridgeToken?.trim() ?? "";
  const request = options.request ?? fetch;
  const timeoutMs = readTimeout(options.timeoutMs);
  return Object.freeze({
    async read(path: string): Promise<DashboardHttpResponse> {
      const supported = Object.values(UPBIT_READONLY_ROUTE_PATHS).some((candidate) => candidate === path) || /^\/api\/v1\/orders\/[0-9a-f-]{20,64}$/i.test(path);
      if (!bridgeToken || !supported) return relayUnavailable();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await request(`${origin}${path}`, {
          method: "GET",
          redirect: "error",
          headers: { authorization: `Bearer ${bridgeToken}`, accept: "application/json" },
          signal: controller.signal
        });
        const payload = parseJson(await response.text());
        if (!response.ok || payload === undefined) return relayUnavailable();
        return dashboardJsonResponse(200, payload);
      } catch {
        return relayUnavailable();
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

/** Authorizes a mobile/dashboard reader before forwarding to the server-side relay. */
export function handleUpbitReadOnlyHttp(
  request: DashboardHttpRequest,
  path: string,
  dependencies: UpbitReadOnlyHttpDependencies
): Promise<DashboardHttpResponse> {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return Promise.resolve(authorization.response);
  return dependencies.relay.read(path);
}
