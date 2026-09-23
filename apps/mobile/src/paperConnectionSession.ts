import { clearDashboardCredentialSession, setDashboardCredentialEndpoint } from "./dashboardCredentialSession";
import { clearMobileApprovedSessionMemory, mobileApprovedSession } from "./mobileApprovedSessionBoundary";
import { connectUpbitReadOnlyAccount, resetUpbitReadOnlyState } from "./upbitReadOnlyAccount";
import type { OwnerDeviceCredentialNative } from "./ownerDeviceCredential";

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

function scheduleRestoreRetry(endpoint: string, force: boolean, silent?: Readonly<{ deviceId: string; native: OwnerDeviceCredentialNative }>): void {
  if (restoreRetryTimer != null || configuredEndpoint !== endpoint || isPaperConnectionVerified(endpoint)) return;
  const delay = Math.min(RESTORE_RETRY_MAX_MS, RESTORE_RETRY_BASE_MS * (2 ** restoreRetryAttempts));
  restoreRetryAttempts += 1;
  restoreRetryTimer = setTimeout(() => {
    restoreRetryTimer = null;
    // A scheduled retry must repeat the same attempt that failed. Dropping force/silent here
    // silently downgraded every retry to the bearer-refresh restore() path, so a device whose
    // silent DeviceKey check failed only transiently never got a second silent attempt -- it
    // depended on a persisted bearer refresh surviving background/Doze, which foreground restores
    // never rely on by design.
    if (configuredEndpoint === endpoint && !isPaperConnectionVerified(endpoint)) void restoreApprovedSession(endpoint, force, silent);
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

function restoreApprovedSession(endpoint: string, force = false, silent?: Readonly<{ deviceId: string; native: OwnerDeviceCredentialNative }>): Promise<void> {
  if (restoreInFlight != null) return restoreInFlight;
  const generation = ++restoreGeneration;
  const operation = (async () => {
    // Foreground recovery must not trust the process-local VERIFIED flag as proof that the
    // credential survived hours of Android background/Doze. Prefer a fresh hardware-bound
    // DeviceKey challenge whenever the adapter is available; otherwise retain the existing
    // rotating-session restore path for platforms without that adapter.
    if (force && silent != null) return mobileApprovedSession().restoreWithSilentDevice(endpoint, silent.deviceId, silent.native);
    return mobileApprovedSession().restore(endpoint);
  })().then((identity) => {
    if (generation !== restoreGeneration || configuredEndpoint !== endpoint) return;
    if (identity != null) {
      verifiedEndpoint = endpoint;
      cancelRestoreRetry();
      // The Upbit relay uses this same PAPER session and has no separate mobile
      // credential. Re-establish its GET-only monitor after a cold-start restore.
      void connectUpbitReadOnlyAccount(endpoint);
    } else if (mobileApprovedSession().shouldRetryRestore()) {
      scheduleRestoreRetry(endpoint, force, silent);
    }
  }).catch(() => {
    if (generation === restoreGeneration && configuredEndpoint === endpoint) verifiedEndpoint = null;
  });
  restoreInFlight = operation;
  void operation.finally(() => {
    if (restoreInFlight !== operation) return;
    restoreInFlight = null;
    // A transient failure may have scheduled an immediate retry (tests and foreground wakeups can
    // collapse timers to a microtask). If that callback observed this operation as in-flight it
    // safely no-oped; re-arm once after clearing the single-flight slot so recovery cannot stall.
    if (configuredEndpoint === endpoint && !isPaperConnectionVerified(endpoint) && mobileApprovedSession().shouldRetryRestore()) scheduleRestoreRetry(endpoint, force, silent);
  });
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

/**
 * Session state for projection only. An unverified session on a configured endpoint is not a
 * setup problem while a restore is in flight or a bounded retry is armed: the device is still
 * trusted and recovery needs no owner input. Only RECOVERY_REQUIRED (no restore running and none
 * scheduled, e.g. after a definitive 401/403 rejection) means the owner must act in Settings.
 * Transport loss, network loss and background suspension must never surface as RECOVERY_REQUIRED
 * by themselves; that classification belongs to mobileApprovedSession, not to the UI.
 */
export type PaperSessionState = "NOT_CONFIGURED" | "VERIFIED" | "RECOVERING" | "RECOVERY_REQUIRED";
export function getPaperSessionState(): PaperSessionState {
  if (configuredEndpoint == null) return "NOT_CONFIGURED";
  if (isPaperConnectionVerified(configuredEndpoint)) return "VERIFIED";
  if (restoreInFlight != null || restoreRetryTimer != null) return "RECOVERING";
  return "RECOVERY_REQUIRED";
}

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
export function resumePaperConnection(silent?: Readonly<{ deviceId: string; native: OwnerDeviceCredentialNative }>): void {
  const endpoint = configuredEndpoint;
  if (endpoint == null) return;
  // A VERIFIED flag is only a process-local observation. Android can preserve it while the app is
  // backgrounded long enough for the actual access credential to expire. Always revalidate on
  // foreground; restoreApprovedSession is single-flight so duplicate lifecycle events coalesce.
  cancelRestoreRetry();
  void restoreApprovedSession(endpoint, true, silent);
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
