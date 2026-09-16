import { clearDashboardCredentialSession, setDashboardCredentialEndpoint } from "./dashboardCredentialSession";
import { clearMobileApprovedSessionMemory, mobileApprovedSession } from "./mobileApprovedSessionBoundary";
import { connectUpbitReadOnlyAccount, resetUpbitReadOnlyState } from "./upbitReadOnlyAccount";

let configuredEndpoint: string | null = null;
let verifiedEndpoint: string | null = null;
let restoreGeneration = 0;
let restoreInFlight: Promise<void> | null = null;
let restoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
let restoreRetryAttempts = 0;
const RESTORE_RETRY_BASE_MS = 1_000;
const RESTORE_RETRY_MAX_MS = 30_000;

function cancelRestoreRetry(): void {
  if (restoreRetryTimer != null) clearTimeout(restoreRetryTimer);
  restoreRetryTimer = null;
  restoreRetryAttempts = 0;
}

function scheduleRestoreRetry(endpoint: string): void {
  if (restoreRetryTimer != null || configuredEndpoint !== endpoint || isPaperConnectionVerified(endpoint)) return;
  const delay = Math.min(RESTORE_RETRY_MAX_MS, RESTORE_RETRY_BASE_MS * (2 ** restoreRetryAttempts));
  restoreRetryAttempts += 1;
  restoreRetryTimer = setTimeout(() => {
    restoreRetryTimer = null;
    if (configuredEndpoint === endpoint && !isPaperConnectionVerified(endpoint)) void restoreApprovedSession(endpoint);
  }, delay);
}

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
    if (generation !== restoreGeneration || configuredEndpoint !== endpoint) return;
    if (identity != null) {
      verifiedEndpoint = endpoint;
      cancelRestoreRetry();
      // The Upbit relay uses this same PAPER session and has no separate mobile
      // credential. Re-establish its GET-only monitor after a cold-start restore.
      void connectUpbitReadOnlyAccount(endpoint);
    } else if (mobileApprovedSession().shouldRetryRestore()) {
      scheduleRestoreRetry(endpoint);
    }
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
    cancelRestoreRetry();
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
  void connectUpbitReadOnlyAccount(endpoint);
}

export function clearPaperConnectionVerification(): void { verifiedEndpoint = null; restoreGeneration += 1; cancelRestoreRetry(); }
export function isPaperConnectionVerified(value = configuredEndpoint): boolean { return value != null && normalizeEndpoint(value) === verifiedEndpoint; }
/**
 * Best-effort Cloud restore performed during app entry. LOCAL PAPER does not require
 * a restored Cloud session, so entry readiness is independent from Cloud verification.
 * Callers that need Cloud authority must still require isPaperConnectionVerified().
 */
export async function restoreConfiguredPaperSession(value = configuredEndpoint): Promise<boolean> {
  const endpoint = value == null ? null : normalizeEndpoint(value);
  if (endpoint == null) return true;
  if (endpoint !== configuredEndpoint) return false;
  if (!isPaperConnectionVerified(endpoint)) {
    if (restoreInFlight != null) await restoreInFlight;
    else await restoreApprovedSession(endpoint);
  }
  return true;
}
/**
 * Re-establishes the PAPER session when the app returns to the foreground.
 *
 * The restore retry backs off to 30 seconds, and Android suspends timers while the app is
 * backgrounded, so a device that spends hours in the background comes back with either a timer the
 * OS never fired or one that is capped at its slowest interval. The owner then opens the app to a
 * disconnected PAPER server and has no action available except reconnecting by hand, which is the
 * thing the paired session exists to avoid.
 *
 * Resuming resets the backoff and asks for a restore immediately. It needs no token and no owner
 * interaction: the device already holds an approved, rotating session in Android secure storage,
 * and this only exchanges it again. A session that has genuinely lapsed still fails closed, and the
 * device must be re-approved by an ACTIVE OWNER exactly as before.
 */
export function resumePaperConnection(): void {
  const endpoint = configuredEndpoint;
  if (endpoint == null) return;
  if (isPaperConnectionVerified(endpoint)) return;
  // Drop the slow timer first so the resume attempt is immediate rather than queued behind it.
  cancelRestoreRetry();
  if (restoreInFlight == null) void restoreApprovedSession(endpoint);
}

export function clearConfiguredPaperEndpoint(): void {
  configuredEndpoint = null;
  verifiedEndpoint = null;
  restoreGeneration += 1;
  restoreInFlight = null;
  cancelRestoreRetry();
  setDashboardCredentialEndpoint(null);
  clearCredentialMemory();
  resetUpbitReadOnlyState();
}
