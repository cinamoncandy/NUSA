import { tryReadCanonicalNusaOrigin } from "./canonicalOrigin";
import { clearDashboardCredentialSession } from "./dashboardCredentialSession";

let configuredEndpoint: string | null = tryReadCanonicalNusaOrigin();
let verifiedEndpoint: string | null = null;

function normalizeEndpoint(value: string): string | null {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || null;
}

function effectiveEndpoint(value: string): string | null {
  return normalizeEndpoint(value) ?? tryReadCanonicalNusaOrigin();
}

/**
 * Process-local PAPER endpoint authority.
 *
 * Production Android builds prefer the build-provided canonical HTTPS origin whenever the
 * persisted legacy endpoint is empty. Explicit non-empty endpoints remain supported only for
 * controlled development/migration flows. Endpoint identity changes revoke the ephemeral
 * credential and verification state.
 */
export function setConfiguredPaperEndpoint(value: string): void {
  const next = effectiveEndpoint(value);
  if (configuredEndpoint !== next) {
    verifiedEndpoint = null;
    clearDashboardCredentialSession();
  }
  configuredEndpoint = next;
}

export function getConfiguredPaperEndpoint(): string | null {
  return configuredEndpoint ?? tryReadCanonicalNusaOrigin();
}

export function markPaperConnectionVerified(value: string): void {
  const endpoint = normalizeEndpoint(value);
  const current = getConfiguredPaperEndpoint();
  if (endpoint == null || endpoint !== current) throw new Error("PAPER endpoint verification mismatch.");
  verifiedEndpoint = endpoint;
}

export function clearPaperConnectionVerification(): void { verifiedEndpoint = null; }
export function isPaperConnectionVerified(value = getConfiguredPaperEndpoint()): boolean { return value != null && normalizeEndpoint(value) === verifiedEndpoint; }
export function clearConfiguredPaperEndpoint(): void {
  configuredEndpoint = tryReadCanonicalNusaOrigin();
  verifiedEndpoint = null;
  clearDashboardCredentialSession();
}
