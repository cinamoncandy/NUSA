import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";
import { normalizePaperEndpoint } from "./settings";

const MAX_TOKEN_LENGTH = 4096;

interface DashboardCredentialState {
  readonly token: string;
  readonly endpoint: string;
  readonly verified: boolean;
}

/**
 * Process-memory-only credential boundary for the single personal operator session.
 * A token is usable by dashboard reads/PAPER submit only after the same normalized endpoint
 * has completed a successful connection verification. No persistence adapter receives it.
 */
export class InMemoryDashboardCredentialSession {
  private static state: DashboardCredentialState | null = null;

  public beginVerification(value: string, endpointValue: string): void {
    const token = value.trim();
    if (token.length < 16 || token.length > MAX_TOKEN_LENGTH) throw new Error("Dashboard credential is invalid.");
    const endpoint = normalizePaperEndpoint(endpointValue);
    if (!endpoint) throw new Error("PAPER endpoint is not configured.");
    InMemoryDashboardCredentialSession.state = Object.freeze({ token, endpoint, verified: false });
  }

  /** Backward-compatible staged connect; callers must verify before the token becomes generally usable. */
  public connect(value: string, endpointValue = ""): void {
    this.beginVerification(value, endpointValue);
  }

  public markVerified(endpointValue: string): void {
    const endpoint = normalizePaperEndpoint(endpointValue);
    const state = InMemoryDashboardCredentialSession.state;
    if (state == null || !endpoint || state.endpoint !== endpoint) throw new Error("PAPER connection verification identity mismatch.");
    InMemoryDashboardCredentialSession.state = Object.freeze({ ...state, verified: true });
  }

  public clear(): void { InMemoryDashboardCredentialSession.state = null; }
  public isConfigured(): boolean { return InMemoryDashboardCredentialSession.state?.verified === true; }
  public isVerifiedFor(endpointValue: string): boolean {
    const state = InMemoryDashboardCredentialSession.state;
    if (state?.verified !== true) return false;
    try { return state.endpoint === normalizePaperEndpoint(endpointValue); } catch { return false; }
  }
  public verifiedEndpoint(): string | null { return InMemoryDashboardCredentialSession.state?.verified === true ? InMemoryDashboardCredentialSession.state.endpoint : null; }

  /** Provider used only while Settings actively verifies the staged token against its bound endpoint. */
  public readonly verificationCredentialProvider: DashboardCredentialProvider = async () => InMemoryDashboardCredentialSession.state?.token ?? null;

  /** General provider refuses unverified staged credentials. */
  public readonly credentialProvider: DashboardCredentialProvider = async () => InMemoryDashboardCredentialSession.state?.verified === true ? InMemoryDashboardCredentialSession.state.token : null;

  public credentialProviderFor(endpointValue: string): DashboardCredentialProvider {
    return async () => this.isVerifiedFor(endpointValue) ? InMemoryDashboardCredentialSession.state!.token : null;
  }
}
