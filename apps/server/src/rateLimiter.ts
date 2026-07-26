/**
 * A minimal fixed-window rate limiter for this server's /api/ routes -- this app ships with no
 * authentication layer at all (see docs/implementation/web-single-user-paper-app-v0.1.md's
 * scope notes), so a basic request-volume guard is the one abuse protection available: it
 * bounds how fast a single client (misbehaving script, browser tab stuck in a tight retry
 * loop, or -- if this server is ever reachable beyond localhost -- an outside caller) can hit
 * the API, without requiring any credential the operator would have to manage.
 *
 * Fixed-window (not sliding-window/token-bucket): a window resets a client's count to zero the
 * moment `windowMs` elapses since that client's *first* request in the current window, rather
 * than smoothing usage continuously. This can allow a short burst near a window boundary
 * (up to ~2x maxRequests across the boundary), but that's an acceptable trade for staying this
 * simple -- the goal is catching a runaway loop within a few seconds, not precise traffic
 * shaping.
 */
export interface RateLimiterOptions {
  readonly windowMs: number;
  readonly maxRequests: number;
  /** Injected for deterministic tests; defaults to the real clock. */
  readonly now?: () => number;
}

/** Hard cap on distinct tracked keys, so a flood of requests spoofing many different keys
 * can't grow this map without bound -- evicts the single oldest window when exceeded. A real
 * single-user deployment behind one IP never approaches this. */
const MAX_TRACKED_KEYS = 1000;

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) throw new Error("windowMs must be positive");
    if (!Number.isInteger(options.maxRequests) || options.maxRequests <= 0) throw new Error("maxRequests must be a positive integer");
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.now = options.now ?? Date.now;
  }

  /** Returns true (and counts the request) if key is still within its limit for the current
   * window; false if key has already hit maxRequests this window. */
  allow(key: string): boolean {
    const now = this.now();
    const entry = this.hits.get(key);
    if (entry === undefined || now - entry.windowStart >= this.windowMs) {
      if (entry === undefined && this.hits.size >= MAX_TRACKED_KEYS) this.evictOldest();
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= this.maxRequests) return false;
    entry.count += 1;
    return true;
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestStart = Infinity;
    for (const [key, entry] of this.hits) {
      if (entry.windowStart < oldestStart) { oldestStart = entry.windowStart; oldestKey = key; }
    }
    if (oldestKey !== undefined) this.hits.delete(oldestKey);
  }
}
