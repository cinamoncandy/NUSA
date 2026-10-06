/**
 * Warms the network connection to the configured PAPER server while the app is still reading its saved session, so the first signed-in
 * request does not also pay for the DNS lookup, the TCP connection and the TLS handshake (about three round trips, long from abroad).
 *
 * One plain GET of the server's public /health, sent once per endpoint per process:
 * - it carries no credential, header, cookie or body, and its answer is discarded (never read, never trusted);
 * - only an https endpoint is touched, and a redirect is an error, so it cannot be sent anywhere else;
 * - a failure, timeout or an absent transport is silent and changes nothing: the real sign-in still runs exactly as before.
 * Nothing happens until the app registers its fetch at start-up, so tests and any host without a transport make no request.
 * Dependency-free on purpose.
 */
type FetchLike = (url: string, init: { method: "GET"; redirect: "error"; cache: "no-store"; signal?: unknown }) => Promise<unknown>;

const WARMUP_TIMEOUT_MS = 4_000;
const warmed = new Set<string>();
let transport: FetchLike | null = null;

/** Registers the transport the warm-up may use (the app passes its fetch once at start-up); null disables it. */
export function registerConnectionWarmup(fetchImpl: FetchLike | null): void {
  transport = fetchImpl;
}

export function resetConnectionWarmupForTest(): void {
  warmed.clear();
  transport = null;
}

/** Fire and forget. Returns true when a warm-up request was started for this endpoint, false when it was skipped. */
export function warmConnection(endpoint: string): boolean {
  const url = endpoint.replace(/\/+$/, "");
  if (transport == null || !/^https:\/\/[^\s/]+$/.test(url) || warmed.has(url)) return false;
  warmed.add(url);
  try {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller == null ? null : setTimeout(() => { try { controller.abort(); } catch { /* nothing to abort */ } }, WARMUP_TIMEOUT_MS);
    const finish = () => { if (timer != null) clearTimeout(timer); };
    Promise.resolve(transport(`${url}/health`, { method: "GET", redirect: "error", cache: "no-store", ...(controller == null ? {} : { signal: controller.signal }) })).then(finish, finish);
    return true;
  } catch {
    return false;
  }
}
