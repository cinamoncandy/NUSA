import { clearDashboardCredentialSession, setDashboardCredentialEndpoint } from "./dashboardCredentialSession";
import { clearMobileApprovedSessionMemory, mobileApprovedSession } from "./mobileApprovedSessionBoundary";
import { tryReadCanonicalNusaOrigin } from "./canonicalOrigin";

const buildConfiguredEndpoint = tryReadCanonicalNusaOrigin();
let configuredEndpoint: string | null = buildConfiguredEndpoint;
let verifiedEndpoint: string | null = null;
let restoreGeneration = 0;

function normalizeEndpoint(value: string): string | null {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || null;
}

function effectiveEndpoint(value: string): string | null {
  return buildConfiguredEndpoint ?? normalizeEndpoint(value);
}

function clearCredentialMemory(): void {
  clearDashboardCredentialSession();
  clearMobileApprovedSessionMemory();
}

function restoreApprovedSession(endpoint: string): void {
  const generation = ++restoreGeneration;
  void mobileApprovedSession().restore(endpoint).then((identity) => {
    if (generation !== restoreGeneration || configuredEndpoint !== endpoint || identity == null) return;
    verifiedEndpoint = endpoint;
  }).catch(() => {
    if (generation === restoreGeneration && configuredEndpoint === endpoint) verifiedEndpoint = null;
  });
}

/**
 * Process-local PAPER endpoint authority.
 * Release builds use the packaged canonical HTTPS origin; persisted Settings input is only a development fallback.
 * Endpoint identity changes revoke all ephemeral access credentials.
 */
export function setConfiguredPaperEndpoint(value: string): void {
  const next = effectiveEndpoint(value);
  if (configuredEndpoint !== next) {
    verifiedEndpoint = null;
    restoreGeneration += 1;
    clearCredentialMemory();
  }
  configuredEndpoint = next;
  setDashboardCredentialEndpoint(next);
  if (next != null) restoreApprovedSession(next);
}

export function getConfiguredPaperEndpoint(): string | null { return configuredEndpoint; }

export function markPaperConnectionVerified(value: string): void {
  const endpoint = effectiveEndpoint(value);
  if (endpoint == null || endpoint !== configuredEndpoint) throw new Error("PAPER endpoint verification mismatch.");
  verifiedEndpoint = endpoint;
}

export function clearPaperConnectionVerification(): void { verifiedEndpoint = null; restoreGeneration += 1; }
export function isPaperConnectionVerified(value = configuredEndpoint): boolean { return value != null && effectiveEndpoint(value) === verifiedEndpoint; }
export function clearConfiguredPaperEndpoint(): void {
  configuredEndpoint = buildConfiguredEndpoint;
  verifiedEndpoint = null;
  restoreGeneration += 1;
  setDashboardCredentialEndpoint(buildConfiguredEndpoint);
  clearCredentialMemory();
  if (buildConfiguredEndpoint != null) restoreApprovedSession(buildConfiguredEndpoint);
}
