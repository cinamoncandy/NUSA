import { clearDashboardCredentialSession, setDashboardCredentialEndpoint } from "./dashboardCredentialSession";
import { clearMobileApprovedSessionMemory, mobileApprovedSession } from "./mobileApprovedSessionBoundary";

let configuredEndpoint: string | null = null;
let verifiedEndpoint: string | null = null;
let restoreGeneration = 0;
let restoreInFlight: Promise<void> | null = null;

function normalizeEndpoint(value: string): string | null {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || null;
}

function clearCredentialMemory(): void {
  clearDashboardCredentialSession();
  clearMobileApprovedSessionMemory();
}

function restoreApprovedSession(endpoint: string): Promise<void> {
  const generation = ++restoreGeneration;
  const operation = mobileApprovedSession().restore(endpoint).then((identity) => {
    if (generation !== restoreGeneration || configuredEndpoint !== endpoint || identity == null) return;
    verifiedEndpoint = endpoint;
  }).catch(() => {
    if (generation === restoreGeneration && configuredEndpoint === endpoint) verifiedEndpoint = null;
  });
  restoreInFlight = operation;
  void operation.finally(() => { if (restoreInFlight === operation) restoreInFlight = null; });
  return operation;
}

/** Process-local mirror of the persisted non-secret PAPER endpoint. Endpoint identity changes revoke all ephemeral access credentials. */
export function setConfiguredPaperEndpoint(value: string): void {
  const next = normalizeEndpoint(value);
  const changed = configuredEndpoint !== next;
  if (changed) {
    verifiedEndpoint = null;
    restoreGeneration += 1;
    clearCredentialMemory();
  }
  configuredEndpoint = next;
  setDashboardCredentialEndpoint(next);
  if (next != null && (changed || (!isPaperConnectionVerified(next) && restoreInFlight == null))) restoreApprovedSession(next);
}

export function getConfiguredPaperEndpoint(): string | null { return configuredEndpoint; }

export function markPaperConnectionVerified(value: string): void {
  const endpoint = normalizeEndpoint(value);
  if (endpoint == null || endpoint !== configuredEndpoint) throw new Error("PAPER endpoint verification mismatch.");
  verifiedEndpoint = endpoint;
}

export function clearPaperConnectionVerification(): void { verifiedEndpoint = null; restoreGeneration += 1; }
export function isPaperConnectionVerified(value = configuredEndpoint): boolean { return value != null && normalizeEndpoint(value) === verifiedEndpoint; }
export async function restoreConfiguredPaperSession(value = configuredEndpoint): Promise<boolean> {
  const endpoint = value == null ? null : normalizeEndpoint(value);
  if (endpoint == null || endpoint !== configuredEndpoint) return false;
  if (!isPaperConnectionVerified(endpoint)) {
    if (restoreInFlight != null) await restoreInFlight;
    else await restoreApprovedSession(endpoint);
  }
  return isPaperConnectionVerified(endpoint);
}
export function clearConfiguredPaperEndpoint(): void {
  configuredEndpoint = null;
  verifiedEndpoint = null;
  restoreGeneration += 1;
  restoreInFlight = null;
  setDashboardCredentialEndpoint(null);
  clearCredentialMemory();
}
