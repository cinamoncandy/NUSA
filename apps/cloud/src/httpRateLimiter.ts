import { createHash } from "node:crypto";
import { DeterministicRateLimitManager, RateLimitDecisionType, type RateLimitBucketPolicy } from "../../../apps/execution/src/rate-limit-manager";

export interface HttpRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
  readonly reason?: string;
}

export interface HttpRateLimiterOptions {
  readonly policy?: RateLimitBucketPolicy;
  readonly maxBuckets?: number;
}

const defaultPolicy: RateLimitBucketPolicy = Object.freeze({
  capacity: 120,
  refillTokens: 120,
  refillIntervalMs: 60_000,
  maximumQueueDelayMs: 0,
  maximumTrackedRequests: 512
});

const safeNow = (() => {
  let last = 0;
  return (): number => {
    const observed = Date.now();
    last = Math.max(last, Number.isSafeInteger(observed) && observed >= 0 ? observed : last);
    return last;
  };
})();

const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);

export function rateLimitIdentity(authorization: string | undefined, remoteAddress: string | undefined): string {
  if (authorization?.trim()) return `token:${digest(authorization.trim())}`;
  return `network:${digest(remoteAddress?.trim() || "anonymous")}`;
}

export class BoundedHttpRateLimiter {
  private readonly buckets = new Map<string, DeterministicRateLimitManager>();
  private readonly policy: RateLimitBucketPolicy;
  private readonly maxBuckets: number;

  public constructor(options: HttpRateLimiterOptions = {}) {
    this.policy = options.policy ?? defaultPolicy;
    this.maxBuckets = options.maxBuckets ?? 256;
    if (!Number.isSafeInteger(this.maxBuckets) || this.maxBuckets <= 0) throw new Error("maxBuckets must be a positive safe integer");
  }

  /**
   * Reclaim registry slots from buckets that have fully refilled and hold no replayable
   * decision. Only idle buckets are evicted, so a caller that is currently being throttled
   * cannot reset its own limit by flooding the registry with fresh identities. Returns true
   * when a slot became available.
   */
  private evictIdleBuckets(nowMs: number): boolean {
    let evicted = false;
    for (const [key, bucket] of this.buckets) {
      // A bucket that cannot report its state is retained rather than reclaimed, so an
      // unexpected fault never widens the limit.
      let idle = false;
      try { idle = bucket.isIdle(nowMs); } catch { idle = false; }
      if (!idle) continue;
      this.buckets.delete(key);
      evicted = true;
    }
    return evicted;
  }

  public evaluate(bucketKey: string, requestId: string, weight = 1): HttpRateLimitDecision {
    if (!bucketKey.trim() || !requestId.trim()) return Object.freeze({ allowed: false, reason: "invalid rate-limit identity" });
    let bucket = this.buckets.get(bucketKey);
    if (bucket == null) {
      if (this.buckets.size >= this.maxBuckets) this.evictIdleBuckets(safeNow());
      if (this.buckets.size >= this.maxBuckets) return Object.freeze({ allowed: false, reason: "rate-limit bucket capacity exhausted" });
      bucket = new DeterministicRateLimitManager(this.policy, safeNow());
      this.buckets.set(bucketKey, bucket);
    }
    const decision = bucket.evaluate({ requestId, weight, nowMs: safeNow() });
    if (decision.type === RateLimitDecisionType.ALLOW) return Object.freeze({ allowed: true });
    const retryAfterSeconds = decision.retryAtMs == null ? undefined : Math.max(1, Math.ceil((decision.retryAtMs - safeNow()) / 1000));
    return Object.freeze({ allowed: false, ...(retryAfterSeconds == null ? {} : { retryAfterSeconds }), reason: decision.reason ?? "rate limit exceeded" });
  }
}
