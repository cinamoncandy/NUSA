import {
  UpbitApiError,
  UpbitConfigurationError,
  UpbitRestClient,
  UpbitTransportError,
  type UpbitLiveReadOnlySnapshot,
  type UpbitReadAdapter,
  type UpbitCredentials,
} from "./upbitRestAdapter";
import {
  evaluatePrivateRequestClockEligibility,
  type PrivateRequestClockEvidence,
} from "./privateRequestClockSafety";
import type { UpbitReadOnlyCredentialProvider } from "./upbitReadOnlyCredentialProvider";
import { reconcileReadOnlySnapshots, type UpbitReadOnlyReconciliationResult } from "./upbitReadOnlyReconciliation";

export type UpbitReadOnlyResultCode =
  | "CONNECTED"
  | "NOT_CONFIGURED"
  | "CLOCK_UNSAFE"
  | "INVALID_CREDENTIALS"
  | "IP_NOT_ALLOWED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PROVIDER_ERROR";

export interface UpbitReadOnlyResult<T> {
  readonly ok: boolean;
  readonly code: UpbitReadOnlyResultCode;
  readonly message: string;
  readonly observedAt: string;
  readonly data?: T;
}

export type UpbitReadAdapterFactory = (credentials: UpbitCredentials) => UpbitReadAdapter;
export type PrivateRequestClockEvidenceProvider = () => PrivateRequestClockEvidence;

function redact(message: string): string {
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/(access|secret|api)[_-]?key\s*[:=]\s*[^,\s]+/gi, "$1Key=[redacted]");
}

function mapFailure(error: unknown, aborted: boolean): { code: Exclude<UpbitReadOnlyResultCode, "CONNECTED" | "NOT_CONFIGURED" | "CLOCK_UNSAFE">; message: string } {
  const safe = redact(error instanceof Error ? error.message : "read-only broker request failed");
  if (aborted) return { code: "TIMEOUT", message: "Read-only broker request timed out" };
  if (error instanceof UpbitApiError) {
    if (error.status === 401 || error.status === 403) {
      if (/ip/i.test(safe)) return { code: "IP_NOT_ALLOWED", message: "Read-only broker request was rejected by the configured IP policy" };
      return { code: "INVALID_CREDENTIALS", message: "Read-only broker credentials were rejected" };
    }
    return { code: "PROVIDER_ERROR", message: safe };
  }
  if (error instanceof UpbitTransportError) return { code: "NETWORK_ERROR", message: safe };
  if (error instanceof UpbitConfigurationError) return { code: "INVALID_CREDENTIALS", message: "Read-only broker credentials are invalid" };
  return { code: "PROVIDER_ERROR", message: safe };
}

export class UpbitReadOnlyService {
  private previousSnapshot: UpbitLiveReadOnlySnapshot | null = null;

  public constructor(
    private readonly credentials: UpbitReadOnlyCredentialProvider,
    private readonly adapterFactory: UpbitReadAdapterFactory = (value) => new UpbitRestClient({ credentials: value }),
    private readonly clockEvidence?: PrivateRequestClockEvidenceProvider,
  ) {}

  async status(): Promise<Awaited<ReturnType<UpbitReadOnlyCredentialProvider["status"]>>> {
    return this.credentials.status();
  }

  async testConnection(timeoutMs = 10_000): Promise<UpbitReadOnlyResult<UpbitLiveReadOnlySnapshot>> {
    const startedAt = new Date().toISOString();

    if (this.clockEvidence) {
      try {
        const eligibility = evaluatePrivateRequestClockEligibility(this.clockEvidence());
        if (!eligibility.eligible) {
          return Object.freeze({
            ok: false,
            code: "CLOCK_UNSAFE",
            message: `Signed/private broker request blocked by clock safety: ${eligibility.reasonCodes.join(",")}`,
            observedAt: startedAt,
          });
        }
      } catch {
        return Object.freeze({
          ok: false,
          code: "CLOCK_UNSAFE",
          message: "Signed/private broker request blocked because clock evidence could not be evaluated",
          observedAt: startedAt,
        });
      }
    }

    const credentials = await this.credentials.loadForReadOnlyUse();
    if (!credentials) {
      return Object.freeze({ ok: false, code: "NOT_CONFIGURED", message: "Read-only broker access is not configured", observedAt: startedAt });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const adapter: UpbitReadAdapter = this.adapterFactory(credentials);
      const data = await adapter.captureSnapshot("KRW-BTC", controller.signal);
      this.previousSnapshot = data;
      return Object.freeze({ ok: true, code: "CONNECTED", message: "Authenticated read-only broker access succeeded", observedAt: data.observedAt, data });
    } catch (error) {
      const failure = mapFailure(error, controller.signal.aborted);
      return Object.freeze({ ok: false, code: failure.code, message: failure.message, observedAt: startedAt });
    } finally {
      clearTimeout(timer);
    }
  }

  async captureSnapshot(timeoutMs = 10_000): Promise<UpbitReadOnlyResult<UpbitLiveReadOnlySnapshot>> {
    return this.testConnection(timeoutMs);
  }

  async reconcileLatest(timeoutMs = 10_000): Promise<UpbitReadOnlyResult<UpbitReadOnlyReconciliationResult>> {
    const baseline = this.previousSnapshot;
    const current = await this.testConnection(timeoutMs);
    if (!current.ok || !current.data) return current as unknown as UpbitReadOnlyResult<UpbitReadOnlyReconciliationResult>;
    const reconciliation = reconcileReadOnlySnapshots(baseline, current.data);
    this.previousSnapshot = current.data;
    return Object.freeze({ ...current, data: reconciliation, message: reconciliation.reason });
  }
}
