import { mobileApprovedSession } from "./mobileApprovedSessionBoundary";
import { MobileSessionRequestError } from "./mobileApprovedSession";

const MAX_TOKEN_LENGTH = 4096;
export const LEGACY_MOBILE_BOOTSTRAP_PREFIX = "legacy-bootstrap:";
let sharedEndpoint: string | null = null;
let pendingBootstrapToken: string | null = null;
// A successfully consumed bootstrap may be kept transiently only long enough to distinguish a
// projection retry from a new credential. It is already single-use and is never persisted.
let lastAuthenticatedBootstrapToken: string | null = null;
let projectionFailureProtectedSession = false;
let lastCredentialFailure: string | null = null;
const MAX_FAILURE_REASON_LENGTH = 300;

/**
 * A credential exchange that fails has exactly one chance to say why: the provider contract
 * returns `null`, so without this the caller can only report "no credential", which reads as a
 * configuration problem even when the real cause was an expired token or a throttled server.
 * The token itself is never part of a reason -- every message below is a fixed string or an
 * HTTP status.
 */
export function describeCredentialFailure(error: unknown): string {
  if (error instanceof MobileSessionRequestError) {
    if (error.status === 401 || error.status === 403) return "연결 토큰이 만료되었거나 이미 사용되었습니다. 새 토큰을 발급받아 다시 입력하세요.";
    if (error.status === 429) return "서버가 요청을 일시적으로 제한하고 있습니다. 잠시 후 다시 시도하세요.";
    if (error.status >= 500) return `서버가 응답하지 못했습니다 (HTTP ${error.status}). 잠시 후 다시 시도하세요.`;
    return `서버가 연결 요청을 거부했습니다 (HTTP ${error.status}).`;
  }
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? message.slice(0, MAX_FAILURE_REASON_LENGTH) : "보안 세션 교환에 실패했습니다.";
}

/** Reads and clears the reason the most recent credential exchange failed. */
export function takeLastCredentialFailure(): string | null {
  const reason = lastCredentialFailure;
  lastCredentialFailure = null;
  return reason;
}

export type DashboardProjectionOutcome = "READY" | "PROJECTION_UNAVAILABLE" | "AUTH_REJECTED";

export interface DashboardCredentialProvider {
  (): Promise<string | null>;
  /** Projection health is reported separately from authentication so a stale read cannot revoke auth. */
  noteProjectionResult?: (outcome: DashboardProjectionOutcome) => void;
}

export function normalizeMobileBootstrapToken(value: string): string {
  const raw = value.trim();
  const token = raw.startsWith(LEGACY_MOBILE_BOOTSTRAP_PREFIX)
    ? raw.slice(LEGACY_MOBILE_BOOTSTRAP_PREFIX.length).trim()
    : raw;
  if (token.length < 16 || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) throw new Error("Mobile bootstrap token is invalid.");
  return token;
}

/** A failed raw bootstrap attempt may be retried as approved-user self-enrollment; an explicit legacy bootstrap must never be reinterpreted as a long-lived credential. */
export function shouldFallbackToMobileEnrollment(value: string, bootstrapReady: boolean): boolean {
  const token = value.trim();
  return Boolean(token)
    && !bootstrapReady
    && token !== lastAuthenticatedBootstrapToken
    && !projectionFailureProtectedSession
    && !token.startsWith(LEGACY_MOBILE_BOOTSTRAP_PREFIX);
}

export function setDashboardCredentialEndpoint(value: string | null): void {
  const next = value?.trim().replace(/\/+$/, "") || null;
  const previous = sharedEndpoint;
  sharedEndpoint = next;
  if (previous != null && previous !== next) {
    pendingBootstrapToken = null;
    lastAuthenticatedBootstrapToken = null;
    projectionFailureProtectedSession = false;
    // Endpoint identity changes are explicit configuration changes. Destroy the old encrypted
    // refresh state; if an access token is still live, best-effort remote revoke remains intact.
    void mobileApprovedSession().disconnect(previous);
  }
}

/** Revokes process-memory credentials. Persistent refresh state is removed by explicit disconnect or rejected on endpoint mismatch. */
export function clearDashboardCredentialSession(): void {
  pendingBootstrapToken = null;
  mobileApprovedSession().clearMemory();
}

/**
 * Compatibility boundary used by Settings and PAPER clients.
 * `connect` accepts an OWNER-issued single-use mobile bootstrap token. The Settings legacy-bootstrap
 * compatibility marker is transport metadata only and is stripped before the secret is exchanged.
 * The first credential request exchanges the token for an approved-user session. Access stays in
 * memory and the rotating refresh credential is persisted only through the platform SecureStoragePort.
 */
export class InMemoryDashboardCredentialSession {
  public connect(value: string): void {
    const raw = value.trim();
    const session = mobileApprovedSession();
    if (projectionFailureProtectedSession && !raw) {
      pendingBootstrapToken = null;
      session.clearMemory();
      return;
    }
    const token = normalizeMobileBootstrapToken(value);
    if (projectionFailureProtectedSession && token === lastAuthenticatedBootstrapToken) {
      pendingBootstrapToken = null;
      session.clearMemory();
      return;
    }
    projectionFailureProtectedSession = false;
    lastAuthenticatedBootstrapToken = null;
    pendingBootstrapToken = token;
    session.clearMemory();
  }

  public clear(): void {
    const endpoint = sharedEndpoint;
    pendingBootstrapToken = null;
    const session = mobileApprovedSession();
    if (projectionFailureProtectedSession) {
      // Settings historically calls clear() after any non-READY PAPER projection. Authentication
      // already succeeded, so preserve encrypted refresh state and only drop ephemeral access.
      session.clearMemory();
      return;
    }
    lastAuthenticatedBootstrapToken = null;
    void session.disconnect(endpoint ?? undefined);
    session.clearMemory();
  }

  public async enroll(userCredential: string, deviceId: string): Promise<void> {
    const endpoint = sharedEndpoint;
    if (endpoint == null) throw new Error("Cloud PAPER origin is not configured for this build.");
    pendingBootstrapToken = null;
    const session = mobileApprovedSession();
    await session.enroll(endpoint, userCredential, deviceId);
  }

  public isConfigured(): boolean { return sharedEndpoint !== null; }

  public readonly credentialProvider: DashboardCredentialProvider = Object.assign(async () => {
    const endpoint = sharedEndpoint;
    if (endpoint == null) return null;
    const session = mobileApprovedSession();
    const pending = pendingBootstrapToken;
    if (pending != null) {
      pendingBootstrapToken = null;
      try {
        lastCredentialFailure = null;
        await session.connectBootstrap(endpoint, pending);
        lastAuthenticatedBootstrapToken = pending;
      } catch (error) {
        lastCredentialFailure = describeCredentialFailure(error);
        const retryable = session.shouldRetryRestore();
        lastAuthenticatedBootstrapToken = retryable ? pending : null;
        projectionFailureProtectedSession = retryable;
        session.clearMemory();
        return null;
      }
    } else if (!session.hasMemoryAccess()) {
      let restored: Awaited<ReturnType<typeof session.restore>>;
      try { lastCredentialFailure = null; restored = await session.restore(endpoint); }
      catch (error) { lastCredentialFailure = describeCredentialFailure(error); return null; }
      if (restored == null) {
        lastCredentialFailure = "저장된 보안 세션이 없거나 만료되었습니다. 연결 토큰을 다시 입력하세요.";
        return null;
      }
    }
    return session.credentialProvider();
  }, {
    noteProjectionResult: (outcome: DashboardProjectionOutcome): void => {
      const session = mobileApprovedSession();
      if (outcome === "READY") {
        projectionFailureProtectedSession = false;
        lastAuthenticatedBootstrapToken = null;
        return;
      }
      if (outcome === "AUTH_REJECTED") {
        projectionFailureProtectedSession = false;
        return;
      }
      if (session.hasMemoryAccess() || session.shouldRetryRestore()) projectionFailureProtectedSession = true;
    }
  });
}
