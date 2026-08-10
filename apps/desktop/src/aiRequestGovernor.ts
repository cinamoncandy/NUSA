/**
 * Caps and caches the six AI research-assistant IPC handlers wired in main.ts
 * (ai:explain-latest-signal, ai:ask-followup-question, ai:explain-challenger-disagreement,
 * ai:summarize-session, ai:explain-regime, ai:explain-risk). Each of those handlers can be
 * triggered by the renderer at any time -- a user mashing a button, or a screen re-rendering
 * on every tick -- and each one that isn't NOT_CONFIGURED costs a real Anthropic API call.
 * This governor sits between the handler and the underlying `explain*`/`summarizeSession`
 * call:
 *
 *  - Rate limiting: at most `maxCallsPerMinute` real calls per handler name in any trailing
 *    60s window. Once exceeded, further calls throw `AiRequestRateLimitedError` instead of
 *    reaching the network.
 *  - Input-based caching: a call is only actually made if no cached result exists for that
 *    exact (handler name, input) pair within `cacheTtlMs`. A cache hit returns immediately
 *    and does not count against the rate limit -- repeatedly re-rendering the same screen
 *    state should be free.
 *
 * No dependency on Electron; this only wraps a supplied async function, so it's testable
 * without a renderer or a real Anthropic client.
 */

interface CacheEntry {
  readonly result: unknown;
  readonly expiresAt: number;
}

export interface AiRequestGovernorOptions {
  /** Maximum real calls per handler name allowed inside any trailing 60s window. */
  readonly maxCallsPerMinute?: number;
  /** How long a cached result stays valid before a fresh call is required, in ms. */
  readonly cacheTtlMs?: number;
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => number;
}

export class AiRequestRateLimitedError extends Error {
  readonly handlerName: string;
  readonly retryAfterMs: number;

  constructor(handlerName: string, retryAfterMs: number) {
    super(`AI 요청이 너무 잦습니다 (${handlerName}). ${Math.max(1, Math.ceil(retryAfterMs / 1000))}초 후 다시 시도하세요.`);
    this.name = "AiRequestRateLimitedError";
    this.handlerName = handlerName;
    this.retryAfterMs = retryAfterMs;
  }
}

const RATE_LIMIT_WINDOW_MS = 60_000;

/** Deterministic JSON stringify with object keys sorted, so cache keys don't depend on
 * property insertion order (the request objects built in main.ts are fresh literals each
 * call, so plain JSON.stringify would otherwise happen to match here -- this just doesn't
 * rely on that). */
function canonicalStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(",")}}`;
}

export class AiRequestGovernor {
  private readonly maxCallsPerMinute: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly callTimestamps = new Map<string, number[]>();
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: AiRequestGovernorOptions = {}) {
    if (options.maxCallsPerMinute !== undefined && (!Number.isFinite(options.maxCallsPerMinute) || options.maxCallsPerMinute <= 0)) {
      throw new Error("maxCallsPerMinute must be positive");
    }
    if (options.cacheTtlMs !== undefined && (!Number.isFinite(options.cacheTtlMs) || options.cacheTtlMs < 0)) {
      throw new Error("cacheTtlMs must be non-negative");
    }
    this.maxCallsPerMinute = options.maxCallsPerMinute ?? 6;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Runs `call()` unless a fresh cached result already exists for (handlerName, cacheKeyInput),
   * or the handler's per-minute budget is exhausted. `cacheKeyInput` should be whatever the
   * handler already computed as its request object (or `undefined` when there's nothing to
   * explain yet) -- it is never sent anywhere, only hashed to key the cache.
   */
  async guard<T>(handlerName: string, cacheKeyInput: unknown, call: () => Promise<T>): Promise<T> {
    const cacheKey = `${handlerName}::${canonicalStringify(cacheKeyInput)}`;
    const nowMs = this.now();

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > nowMs) {
      return cached.result as T;
    }

    const windowStart = nowMs - RATE_LIMIT_WINDOW_MS;
    const timestamps = (this.callTimestamps.get(handlerName) ?? []).filter((timestamp) => timestamp > windowStart);
    if (timestamps.length >= this.maxCallsPerMinute) {
      this.callTimestamps.set(handlerName, timestamps);
      const retryAfterMs = timestamps[0] + RATE_LIMIT_WINDOW_MS - nowMs;
      throw new AiRequestRateLimitedError(handlerName, retryAfterMs);
    }

    timestamps.push(nowMs);
    this.callTimestamps.set(handlerName, timestamps);

    const result = await call();
    this.cache.set(cacheKey, { result, expiresAt: nowMs + this.cacheTtlMs });
    return result;
  }

  /** Test/diagnostics hook -- not used by main.ts's normal request path. */
  reset(): void {
    this.callTimestamps.clear();
    this.cache.clear();
  }
}
