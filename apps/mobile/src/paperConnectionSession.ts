import { clearDashboardCredentialSession } from "./dashboardCredentialSession";

let configuredEndpoint: string | null = null;
let verifiedEndpoint: string | null = null;

function normalizeEndpoint(value: string): string | null {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || null;
}

/** Process-local mirror of the persisted non-secret PAPER endpoint. Endpoint identity changes revoke the ephemeral credential. */
export function setConfiguredPaperEndpoint(value: string): void {
  const next = normalizeEndpoint(value);
  if (configuredEndpoint !== next) {
    verifiedEndpoint = null;
    clearDashboardCredentialSession();
  }
  configuredEndpoint = next;
}

export function getConfiguredPaperEndpoint(): string | null { return configuredEndpoint; }

export function markPaperConnectionVerified(value: string): void {
  const endpoint = normalizeEndpoint(value);
  if (endpoint == null || endpoint !== configuredEndpoint) throw new Error("PAPER endpoint verification mismatch.");
  verifiedEndpoint = endpoint;
}

export function clearPaperConnectionVerification(): void { verifiedEndpoint = null; }
export function isPaperConnectionVerified(value = configuredEndpoint): boolean { return value != null && normalizeEndpoint(value) === verifiedEndpoint; }
export function clearConfiguredPaperEndpoint(): void {
  configuredEndpoint = null;
  verifiedEndpoint = null;
  clearDashboardCredentialSession();
}
