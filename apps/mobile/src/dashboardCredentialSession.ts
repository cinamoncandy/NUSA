const MAX_TOKEN_LENGTH = 4096;
let sharedToken: string | null = null;

export type DashboardCredentialProvider = () => Promise<string | null>;

/** Revokes the process-memory credential for every current/future session instance. */
export function clearDashboardCredentialSession(): void { sharedToken = null; }

/**
 * Process-memory-only credential boundary for the single personal operator session.
 * Instances intentionally share one ephemeral token across Settings, dashboard reads, and PAPER submit.
 * No persistence adapter or application setting receives the credential.
 */
export class InMemoryDashboardCredentialSession {
  public connect(value: string): void {
    const token = value.trim();
    if (token.length < 16 || token.length > MAX_TOKEN_LENGTH) throw new Error("Dashboard credential is invalid.");
    sharedToken = token;
  }
  public clear(): void { clearDashboardCredentialSession(); }
  public isConfigured(): boolean { return sharedToken !== null; }
  public readonly credentialProvider: DashboardCredentialProvider = async () => sharedToken;
}
