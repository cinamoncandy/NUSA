import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";

const MAX_TOKEN_LENGTH = 4096;

/**
 * Process-memory-only credential boundary for the single personal operator session.
 * Instances intentionally share one ephemeral token across Settings, dashboard reads, and PAPER submit.
 * No persistence adapter or application setting receives the credential.
 */
export class InMemoryDashboardCredentialSession {
  private static token: string | null = null;

  public connect(value: string): void {
    const token = value.trim();
    if (token.length < 16 || token.length > MAX_TOKEN_LENGTH) throw new Error("Dashboard credential is invalid.");
    InMemoryDashboardCredentialSession.token = token;
  }
  public clear(): void { InMemoryDashboardCredentialSession.token = null; }
  public isConfigured(): boolean { return InMemoryDashboardCredentialSession.token !== null; }
  public readonly credentialProvider: DashboardCredentialProvider = async () => InMemoryDashboardCredentialSession.token;
}
