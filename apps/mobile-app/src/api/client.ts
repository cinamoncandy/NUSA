import { getApiKey, getDeviceId, getServerUrl } from "../storage/settings";
import type { Account, ApiErrorBody, ControlSnapshot, MarketSnapshot } from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class NotConfiguredError extends Error {}

/** Every call re-reads server URL/API key/device id from storage rather than caching them in
 * memory, so a change on the Settings screen takes effect on the very next request without
 * needing any cross-screen state plumbing. Mirrors apps/web/app.js's fetchJson() contract
 * exactly: same Authorization/X-Device-Id headers, same "unwrap {error} on non-2xx" shape. */
async function request<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new NotConfiguredError("서버 주소가 설정되지 않았습니다.");
  const apiKey = await getApiKey();
  const deviceId = await getDeviceId();

  const headers: Record<string, string> = { "x-device-id": deviceId };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new ApiError("서버에 연결할 수 없습니다. 서버 주소와 네트워크를 확인해 주세요.", 0);
  }

  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (json as Partial<ApiErrorBody>).error ?? `요청 실패 (status ${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  market: () => request<MarketSnapshot>("/api/market"),
  account: () => request<Account>("/api/account"),
  control: () => request<ControlSnapshot>("/api/control"),
  startStrategy: () => request<ControlSnapshot>("/api/strategy/start", { method: "POST" }),
  /** The Kill Switch's real HTTP entry point -- see DOKKAEBI.md's Kill Switch section. */
  stopStrategy: () => request<ControlSnapshot>("/api/strategy/stop", { method: "POST" }),
  setAutoTrade: (enabled: boolean) => request<ControlSnapshot>("/api/strategy/auto-trade", { method: "POST", body: { enabled } })
};
