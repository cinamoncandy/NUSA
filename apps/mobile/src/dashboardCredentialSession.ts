import { mobileApprovedSession } from "./mobileApprovedSessionBoundary";

const MAX_TOKEN_LENGTH = 4096;
export const LEGACY_MOBILE_BOOTSTRAP_PREFIX = "legacy-bootstrap:";
let sharedEndpoint: string | null = null;
let pendingBootstrapToken: string | null = null;

export type DashboardCredentialProvider = () => Promise<string | null>;

export function normalizeMobileBootstrapToken(value: string): string {
  const raw = value.trim();
  const token = raw.startsWith(LEGACY_MOBILE_BOOTSTRAP_PREFIX)
    ? raw.slice(LEGACY_MOBILE_BOOTSTRAP_PREFIX.length).trim()
    : raw;
  if (token.length < 16 || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) throw new Error("Mobile bootstrap token is invalid.");
  return token;
}

export function setDashboardCredentialEndpoint(value: string | null): void {
  sharedEndpoint = value?.trim().replace(/\/+$/, "") || null;
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
    const token = normalizeMobileBootstrapToken(value);
    pendingBootstrapToken = token;
    mobileApprovedSession().clearMemory();
  }

  public clear(): void {
    const endpoint = sharedEndpoint;
    pendingBootstrapToken = null;
    const session = mobileApprovedSession();
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

  public readonly credentialProvider: DashboardCredentialProvider = async () => {
    const endpoint = sharedEndpoint;
    if (endpoint == null) return null;
    const session = mobileApprovedSession();
    const pending = pendingBootstrapToken;
    if (pending != null) {
      pendingBootstrapToken = null;
      try { await session.connectBootstrap(endpoint, pending); }
      catch { session.clearMemory(); return null; }
    } else if (!session.hasMemoryAccess()) {
      const restored = await session.restore(endpoint);
      if (restored == null) return null;
    }
    return session.credentialProvider();
  };
}
