import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";

const MAX_TOKEN_LENGTH = 4096;

/**
 * Process-memory-only credential boundary for the private read-only dashboard.
 * The token is never persisted, serialized, logged, exported, or inferred from local sign-in.
 */
export class InMemoryDashboardCredentialSession {
  private token: string | null = null;

  public connect(value: string): void {
    const token = value.trim();
    if (token.length < 16 || token.length > MAX_TOKEN_LENGTH) throw new Error("Dashboard credential is invalid.");
    this.token = token;
  }

  public clear(): void { this.token = null; }
  public isConfigured(): boolean { return this.token !== null; }

  public readonly credentialProvider: DashboardCredentialProvider = async () => this.token;
}
