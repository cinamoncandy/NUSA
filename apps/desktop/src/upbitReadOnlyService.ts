import { UpbitLiveReadOnlyAdapter, type UpbitLiveReadOnlySnapshot } from "./upbitLiveReadOnlyAdapter";
import type { UpbitCredentialProvider } from "./upbitCredentialProvider";

export type UpbitReadOnlyResultCode = "CONNECTED" | "NOT_CONFIGURED" | "INVALID_CREDENTIALS" | "IP_NOT_ALLOWED" | "NETWORK_ERROR" | "TIMEOUT" | "PROVIDER_ERROR" | "UNKNOWN_ERROR";
export interface UpbitReadOnlyResult<T> { readonly ok: boolean; readonly code: UpbitReadOnlyResultCode; readonly message: string; readonly observedAt: string; readonly data?: T; }

const safeMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "read-only request failed";
  return message.replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").replace(/(access|secret|api)[_-]?key\s*[:=]\s*[^,\s]+/gi, "$1Key=[redacted]");
};

export class UpbitReadOnlyService {
  public constructor(private readonly credentials: UpbitCredentialProvider, private readonly adapterFactory: (credentials: { accessKey: string; secretKey: string }) => UpbitLiveReadOnlyAdapter = (value) => new UpbitLiveReadOnlyAdapter({ credentials: value })) {}

  async status(): Promise<{ configured: boolean; accessKeyHint: string | null }> {
    const value = await this.credentials.loadCredentials();
    return { configured: value !== null, accessKeyHint: value ? `${value.accessKey.slice(0, 4)}…${value.accessKey.slice(-4)}` : null };
  }

  async testConnection(timeoutMs = 10_000): Promise<UpbitReadOnlyResult<UpbitLiveReadOnlySnapshot>> {
    const observedAt = new Date().toISOString();
    const credentials = await this.credentials.loadCredentials();
    if (!credentials) return { ok: false, code: "NOT_CONFIGURED", message: "Upbit read-only access is not configured", observedAt };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const data = await this.adapterFactory(credentials).captureSnapshot("KRW-BTC", controller.signal);
      return { ok: true, code: "CONNECTED", message: "Public and authenticated read-only access succeeded", observedAt: data.observedAt, data };
    } catch (error) {
      const message = safeMessage(error);
      const code: UpbitReadOnlyResultCode = controller.signal.aborted ? "TIMEOUT" : /401|authorization|credential/i.test(message) ? "INVALID_CREDENTIALS" : /ip/i.test(message) ? "IP_NOT_ALLOWED" : /network|fetch|connect/i.test(message) ? "NETWORK_ERROR" : "PROVIDER_ERROR";
      return { ok: false, code, message, observedAt };
    } finally { clearTimeout(timer); }
  }
}
