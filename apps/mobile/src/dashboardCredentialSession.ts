import { mobileApprovedSession } from "./mobileApprovedSessionBoundary";

const MAX_TOKEN_LENGTH = 4096;
let sharedEndpoint: string | null = null;
let pendingBootstrapToken: string | null = null;

export type DashboardCredentialProvider = () => Promise<string | null>;

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
 * `connect` now accepts an OWNER-issued single-use mobile bootstrap token, never a long-lived bearer.
 * The first credential request exchanges it for an approved-user session. Access stays in memory and
 * the rotating refresh credential is persisted only through the platform SecureStoragePort.
 */
export class InMemoryDashboardCredentialSession {
  public connect(value: string): void {
    const token = value.trim();
    if (token.length < 16 || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) throw new Error("Mobile bootstrap token is invalid.");
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
