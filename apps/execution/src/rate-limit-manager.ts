export enum RateLimitDecisionType {
  ALLOW = "ALLOW",
  DELAY = "DELAY",
  BLOCK = "BLOCK"
}

export interface RateLimitBucketPolicy {
  readonly capacity: number;
  readonly refillTokens: number;
  readonly refillIntervalMs: number;
  readonly maximumQueueDelayMs: number;
  readonly maximumTrackedRequests?: number;
  /**
   * How long a memoized decision stays replayable for idempotency. Expired entries are
   * pruned before `maximumTrackedRequests` is enforced, so tracking capacity recovers with
   * time instead of blocking the bucket permanently once the registry has filled once.
   * Defaults to `refillIntervalMs` when omitted.
   */
  readonly decisionRetentionMs?: number;
}

export interface RateLimitRequest {
  readonly requestId: string;
  readonly weight: number;
  readonly nowMs: number;
}

export interface RateLimitDecision {
  readonly type: RateLimitDecisionType;
  readonly requestId: string;
  readonly remainingTokens: number;
  readonly retryAtMs?: number;
  readonly reason?: string;
}

export interface RateLimitState {
  readonly availableTokens: number;
  readonly lastRefillAtMs: number;
}

function assertPolicy(policy: RateLimitBucketPolicy): void {
  if (!Number.isSafeInteger(policy.capacity) || policy.capacity <= 0) throw new Error("capacity must be a positive safe integer");
  if (!Number.isSafeInteger(policy.refillTokens) || policy.refillTokens <= 0) throw new Error("refillTokens must be a positive safe integer");
  if (!Number.isSafeInteger(policy.refillIntervalMs) || policy.refillIntervalMs <= 0) throw new Error("refillIntervalMs must be a positive safe integer");
  if (!Number.isSafeInteger(policy.maximumQueueDelayMs) || policy.maximumQueueDelayMs < 0) throw new Error("maximumQueueDelayMs must be a non-negative safe integer");
  if (policy.maximumTrackedRequests !== undefined && (!Number.isSafeInteger(policy.maximumTrackedRequests) || policy.maximumTrackedRequests <= 0)) throw new Error("maximumTrackedRequests must be a positive safe integer");
  if (policy.decisionRetentionMs !== undefined && (!Number.isSafeInteger(policy.decisionRetentionMs) || policy.decisionRetentionMs <= 0)) throw new Error("decisionRetentionMs must be a positive safe integer");
}

function refill(state: RateLimitState, policy: RateLimitBucketPolicy, nowMs: number): RateLimitState {
  if (!Number.isSafeInteger(nowMs) || nowMs < state.lastRefillAtMs) throw new Error("rate-limit clock moved backwards");
  const intervals = Math.floor((nowMs - state.lastRefillAtMs) / policy.refillIntervalMs);
  if (intervals === 0) return state;
  return Object.freeze({
    availableTokens: Math.min(policy.capacity, state.availableTokens + intervals * policy.refillTokens),
    lastRefillAtMs: state.lastRefillAtMs + intervals * policy.refillIntervalMs
  });
}

export class DeterministicRateLimitManager {
  private state: RateLimitState;
  private readonly decisions = new Map<string, RateLimitDecision>();
  private readonly decisionExpiryMs = new Map<string, number>();
  private lastActivityAtMs: number;

  public constructor(private readonly policy: RateLimitBucketPolicy, initialNowMs: number) {
    assertPolicy(policy);
    if (!Number.isSafeInteger(initialNowMs) || initialNowMs < 0) throw new Error("initialNowMs is invalid");
    this.state = Object.freeze({ availableTokens: policy.capacity, lastRefillAtMs: initialNowMs });
    this.lastActivityAtMs = initialNowMs;
  }

  private get retentionMs(): number {
    return this.policy.decisionRetentionMs ?? this.policy.refillIntervalMs;
  }

  /** Drop memoized decisions whose idempotency window has closed. */
  private pruneDecisions(nowMs: number): void {
    for (const [requestId, expiresAtMs] of this.decisionExpiryMs) {
      if (expiresAtMs > nowMs) continue;
      this.decisionExpiryMs.delete(requestId);
      this.decisions.delete(requestId);
    }
  }

  /**
   * A bucket is idle once it has refilled to capacity and retains no replayable decision.
   * Evicting only idle buckets keeps the registry bounded without letting a throttled caller
   * reset its own limit by forcing an eviction.
   */
  public isIdle(nowMs: number): boolean {
    this.pruneDecisions(nowMs);
    if (this.decisions.size > 0) return false;
    if (nowMs < this.lastActivityAtMs) return false;
    return refill(this.state, this.policy, nowMs).availableTokens >= this.policy.capacity;
  }

  public evaluate(request: RateLimitRequest): RateLimitDecision {
    if (request.requestId.trim() === "") throw new Error("requestId is required");
    if (!Number.isSafeInteger(request.weight) || request.weight <= 0) throw new Error("weight must be a positive safe integer");
    const prior = this.decisions.get(request.requestId);
    if (prior != null) return prior;
    this.pruneDecisions(request.nowMs);
    if (this.policy.maximumTrackedRequests !== undefined && this.decisions.size >= this.policy.maximumTrackedRequests) {
      return Object.freeze({ type: RateLimitDecisionType.BLOCK, requestId: request.requestId, remainingTokens: this.state.availableTokens, reason: "request tracking capacity exhausted" });
    }
    this.state = refill(this.state, this.policy, request.nowMs);
    this.lastActivityAtMs = Math.max(this.lastActivityAtMs, request.nowMs);

    let decision: RateLimitDecision;
    if (request.weight > this.policy.capacity) {
      decision = Object.freeze({ type: RateLimitDecisionType.BLOCK, requestId: request.requestId, remainingTokens: this.state.availableTokens, reason: "request weight exceeds bucket capacity" });
    } else if (request.weight <= this.state.availableTokens) {
      this.state = Object.freeze({ ...this.state, availableTokens: this.state.availableTokens - request.weight });
      decision = Object.freeze({ type: RateLimitDecisionType.ALLOW, requestId: request.requestId, remainingTokens: this.state.availableTokens });
    } else {
      const deficit = request.weight - this.state.availableTokens;
      const intervalsNeeded = Math.ceil(deficit / this.policy.refillTokens);
      const retryAtMs = this.state.lastRefillAtMs + intervalsNeeded * this.policy.refillIntervalMs;
      const delayMs = retryAtMs - request.nowMs;
      decision = delayMs <= this.policy.maximumQueueDelayMs
        ? Object.freeze({ type: RateLimitDecisionType.DELAY, requestId: request.requestId, remainingTokens: this.state.availableTokens, retryAtMs })
        : Object.freeze({ type: RateLimitDecisionType.BLOCK, requestId: request.requestId, remainingTokens: this.state.availableTokens, reason: "required delay exceeds policy" });
    }
    this.decisions.set(request.requestId, decision);
    this.decisionExpiryMs.set(request.requestId, request.nowMs + this.retentionMs);
    return decision;
  }

  public snapshot(): RateLimitState { return this.state; }
}
